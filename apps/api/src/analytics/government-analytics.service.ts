import { Injectable } from '@nestjs/common';
import {
  ANALYTICS_MIN_GROUP_SIZE,
  PROBLEM_SEVERITIES,
  type AnalyticsAreas,
  type AnalyticsCategories,
  type AnalyticsCommunity,
  type AnalyticsFilters,
  type AnalyticsHotspots,
  type AnalyticsOverview,
  type AnalyticsPeriod,
  type AnalyticsRecurring,
  type AnalyticsResolution,
  type AnalyticsTrends,
  type CategoryRow,
  type MapAggregateCell,
  type MetricValue,
  type PriorityTier,
  type ProblemCategory,
  type ProblemSeverity,
  type StageDuration,
} from '@samadhaan/shared';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { GovernmentScope } from '../government/government-access.service.js';
import { RESOLUTION_TYPES } from '../impact/impact-rules.js';
import { AppConfig } from '../config/app.config.js';
import { AnalyticsCacheService } from './analytics-cache.service.js';
import {
  DURATION_BUCKETS,
  HOTSPOT_ALGORITHM,
  HOTSPOT_CELL_DEGREES,
  HOTSPOT_HALF_LIFE_DAYS,
  HOTSPOT_MIN_CELLS,
  STAGE_LABELS,
  bottleneck,
  changePct,
  direction,
  enoughDays,
  funnel,
  ratePct,
  round,
  scoreHotspots,
  suppress,
  type CellAggregate,
} from './analytics-metrics.js';
import {
  EFFECTIVE_TIER,
  RESOLUTION_DAYS,
  filterSql,
  maybe,
  median,
  num,
  span,
  timeline,
} from './analytics-sql.js';
import {
  bucketLabel,
  bucketSql,
  bucketStarts,
  resolvePeriod,
  trueInstant,
  type ResolvedPeriod,
} from './analytics-time.js';
import type { AnalyticsQueryDto } from './analytics.dto.js';

const OPEN = Prisma.raw(`('SUBMITTED','UNDER_REVIEW','VERIFIED','IN_PROGRESS')`);
const RECURRING_ALGORITHM = 'dbscan-300m-14d-v1';
/** Recurring clusters: points within ~300 m, at least 3 reports… */
const RECURRING_EPS_M = 300;
const RECURRING_MIN_POINTS = 3;
/** …from at least 2 people, spread over at least 14 days. */
const RECURRING_MIN_REPORTERS = 2;
const RECURRING_MIN_SPAN_DAYS = 14;

/** What every government analytics read is computed against. */
export interface GovernmentAnalyticsContext {
  scope: GovernmentScope;
  resolved: ResolvedPeriod;
  filters: AnalyticsFilters;
  /** Filters AND the jurisdiction predicate — the authorisation. */
  where: Prisma.Sql;
}

type Row = Record<string, unknown>;

/**
 * Government analytics (Prompt 24): the command centre's aggregates over the
 * office's jurisdiction. Every query includes `scope.jurisdiction.condition`;
 * nothing the client sends widens it. Responses hold aggregates — problem
 * rows leave only through the export, which is audited.
 */
@Injectable()
export class GovernmentAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly cache: AnalyticsCacheService,
  ) {}

  context(scope: GovernmentScope, query: AnalyticsQueryDto): GovernmentAnalyticsContext {
    const resolved = resolvePeriod(query, this.config.analytics.timezone);
    const filters: AnalyticsFilters = {
      category: query.category ?? null,
      severity: query.severity ?? null,
      status: query.status ?? null,
      priority: query.priority ?? null,
      city: query.city ?? null,
      area: query.area ?? null,
    };
    return {
      scope,
      resolved,
      filters,
      where: Prisma.sql`${filterSql(filters)} AND ${scope.jurisdiction.condition}`,
    };
  }

  private cached<T>(
    ctx: GovernmentAnalyticsContext,
    endpoint: string,
    compute: () => Promise<T>,
  ) {
    return this.cache.wrap(
      [
        'gov',
        ctx.scope.organization.id,
        AnalyticsCacheService.jurisdictionKey(ctx.scope.jurisdiction.condition),
        endpoint,
        ctx.resolved.period,
        ctx.filters,
      ],
      compute,
    );
  }

  private envelope(ctx: GovernmentAnalyticsContext) {
    return {
      period: ctx.resolved.period,
      filters: ctx.filters,
      generatedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------- overview

  overview(ctx: GovernmentAnalyticsContext): Promise<AnalyticsOverview> {
    return this.cached(ctx, 'overview', async () => {
      const { start, end, previousStart, previousEnd } = ctx.resolved;
      const [current, previous, active] = await Promise.all([
        this.periodStats(ctx.where, start, end),
        this.periodStats(ctx.where, previousStart, previousEnd),
        this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
          SELECT count(*)::int AS count FROM problems p WHERE ${ctx.where} AND p.status IN ${OPEN}
        `),
      ]);

      const count = (key: keyof PeriodStats & string, metric: string): MetricValue => ({
        key: metric,
        value: current[key] as number,
        previous: previous[key] as number,
        changePct: changePct(current[key] as number, previous[key] as number),
      });
      const rate = (stats: PeriodStats) => ratePct(stats.resolved, stats.verified);
      const days = (
        stats: PeriodStats,
        kind: 'avgVer' | 'medVer' | 'avgRes' | 'medRes',
      ) => enoughDays(stats[kind], kind.endsWith('Ver') ? stats.nVer : stats.nRes);

      return {
        ...this.envelope(ctx),
        metrics: {
          reported: count('reported', 'reported'),
          verified: count('verified', 'verified'),
          inProgress: count('inProgress', 'inProgress'),
          resolved: count('resolved', 'resolved'),
          rejected: count('rejected', 'rejected'),
          criticalHigh: count('criticalHigh', 'criticalHigh'),
          resolutionRate: {
            key: 'resolutionRate',
            value: rate(current),
            previous: rate(previous),
            changePct: null,
          },
          avgDaysToVerification: {
            key: 'avgDaysToVerification',
            value: days(current, 'avgVer'),
            previous: days(previous, 'avgVer'),
          },
          medianDaysToVerification: {
            key: 'medianDaysToVerification',
            value: days(current, 'medVer'),
            previous: days(previous, 'medVer'),
          },
          avgDaysToResolution: {
            key: 'avgDaysToResolution',
            value: days(current, 'avgRes'),
            previous: days(previous, 'avgRes'),
          },
          medianDaysToResolution: {
            key: 'medianDaysToResolution',
            value: days(current, 'medRes'),
            previous: days(previous, 'medRes'),
          },
          activeNow: { key: 'activeNow', value: active[0]?.count ?? 0 },
        },
      };
    });
  }

  private async periodStats(
    where: Prisma.Sql,
    start: Date,
    end: Date,
  ): Promise<PeriodStats> {
    const verification = span('reported_at', 'verified_at');
    const [row] = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      ${timeline(where, start, end)}
      SELECT
        count(*)::int                                              AS reported,
        count(*) FILTER (WHERE verified_f)::int                    AS verified,
        count(*) FILTER (WHERE status = 'IN_PROGRESS')::int        AS "inProgress",
        count(*) FILTER (WHERE status = 'RESOLVED')::int           AS resolved,
        count(*) FILTER (WHERE status = 'REJECTED')::int           AS rejected,
        count(*) FILTER (WHERE tier IN ('CRITICAL','HIGH'))::int   AS "criticalHigh",
        avg(${verification})::float8                               AS "avgVer",
        ${median(verification)}::float8                            AS "medVer",
        count(${verification})::int                                AS "nVer",
        avg(${RESOLUTION_DAYS})::float8                            AS "avgRes",
        ${median(RESOLUTION_DAYS)}::float8                         AS "medRes",
        count(${RESOLUTION_DAYS})::int                             AS "nRes"
      FROM t
    `);
    return {
      reported: num(row.reported),
      verified: num(row.verified),
      inProgress: num(row.inProgress),
      resolved: num(row.resolved),
      rejected: num(row.rejected),
      criticalHigh: num(row.criticalHigh),
      avgVer: maybe(row.avgVer),
      medVer: maybe(row.medVer),
      nVer: num(row.nVer),
      avgRes: maybe(row.avgRes),
      medRes: maybe(row.medRes),
      nRes: num(row.nRes),
    };
  }

  // ------------------------------------------------------------------ trends

  /**
   * Events per local bucket: reports filed, first verifications, rejections
   * and resolutions — each counted when it happened.
   */
  trends(ctx: GovernmentAnalyticsContext): Promise<AnalyticsTrends> {
    return this.cached(ctx, 'trends', async () => {
      const { period, start, end } = ctx.resolved;
      const g = period.granularity;
      const tz = period.timezone;
      const rows = await this.prisma.$queryRaw<
        Array<{ kind: string; bucket: string; count: number }>
      >(
        Prisma.sql`
          SELECT kind, bucket, count(*)::int AS count FROM (
            SELECT 'reported' AS kind, ${bucketSql(Prisma.sql`p."createdAt"`, g, tz)} AS bucket
            FROM problems p
            WHERE ${ctx.where} AND p."createdAt" >= ${start} AND p."createdAt" < ${end}
            UNION ALL
            SELECT 'resolved', ${bucketSql(Prisma.sql`p."resolvedAt"`, g, tz)}
            FROM problems p
            WHERE ${ctx.where} AND p.status = 'RESOLVED'
              AND p."resolvedAt" >= ${start} AND p."resolvedAt" < ${end}
            UNION ALL
            SELECT kind, ${bucketSql(Prisma.sql`decided_at`, g, tz)} FROM (
              SELECT DISTINCT ON (p.id, a.metadata->>'to')
                CASE a.metadata->>'to' WHEN 'VERIFIED' THEN 'verified' ELSE 'rejected' END AS kind,
                a."createdAt" AS decided_at
              FROM audit_logs a
              JOIN problems p ON p.id = a."entityId"
              WHERE a.action = 'PROBLEM_STATUS_CHANGED'
                AND a."entityType" = 'Problem'
                AND a.metadata->>'to' IN ('VERIFIED','REJECTED')
                AND a."createdAt" >= ${start} AND a."createdAt" < ${end}
                AND ${ctx.where}
              ORDER BY p.id, a.metadata->>'to', a."createdAt"
            ) decisions
          ) events
          GROUP BY 1, 2
        `,
      );
      const byBucket = new Map<string, Record<string, number>>();
      for (const row of rows) {
        const entry = byBucket.get(row.bucket) ?? {};
        entry[row.kind] = row.count;
        byBucket.set(row.bucket, entry);
      }
      return {
        ...this.envelope(ctx),
        granularity: g,
        buckets: bucketStarts(period).map((startDate) => {
          const entry = byBucket.get(startDate) ?? {};
          return {
            start: startDate,
            label: bucketLabel(startDate, g),
            reported: entry.reported ?? 0,
            verified: entry.verified ?? 0,
            resolved: entry.resolved ?? 0,
            rejected: entry.rejected ?? 0,
          };
        }),
      };
    });
  }

  // -------------------------------------------------------------- categories

  categories(ctx: GovernmentAnalyticsContext): Promise<AnalyticsCategories> {
    return this.cached(ctx, 'categories', async () => {
      const { period, start, end, previousStart, previousEnd } = ctx.resolved;
      const inRange = (from: Date, to: Date) =>
        Prisma.sql`${ctx.where} AND p."createdAt" >= ${from} AND p."createdAt" < ${to}`;
      const bucket = bucketSql(
        Prisma.sql`p."createdAt"`,
        period.granularity,
        period.timezone,
      );

      const [current, previous, subcategories, severity, priority] = await Promise.all([
        this.prisma.$queryRaw<
          Array<{ category: string; count: number; buckets: number }>
        >(Prisma.sql`
          SELECT p.category::text AS category, count(*)::int AS count,
                 count(DISTINCT ${bucket})::int AS buckets
          FROM problems p WHERE ${inRange(start, end)} GROUP BY 1
        `),
        this.prisma.$queryRaw<Array<{ category: string; count: number }>>(Prisma.sql`
          SELECT p.category::text AS category, count(*)::int AS count
          FROM problems p WHERE ${inRange(previousStart, previousEnd)} GROUP BY 1
        `),
        // Free text: only groups of the minimum size are shown.
        this.prisma.$queryRaw<
          Array<{ category: string; subcategory: string; count: number }>
        >(Prisma.sql`
          SELECT p.category::text AS category, min(trim(p.subcategory)) AS subcategory,
                 count(*)::int AS count
          FROM problems p
          WHERE ${inRange(start, end)} AND p.subcategory IS NOT NULL AND trim(p.subcategory) <> ''
          GROUP BY p.category, lower(trim(p.subcategory))
          HAVING count(*) >= ${ANALYTICS_MIN_GROUP_SIZE}
          ORDER BY 3 DESC, 2
          LIMIT 15
        `),
        this.prisma.$queryRaw<Array<{ severity: string; count: number }>>(Prisma.sql`
          SELECT p.severity::text AS severity, count(*)::int AS count
          FROM problems p WHERE ${inRange(start, end)} GROUP BY 1
        `),
        this.prisma.$queryRaw<Array<{ tier: string; count: number }>>(Prisma.sql`
          SELECT COALESCE(${EFFECTIVE_TIER}::text, 'UNASSESSED') AS tier, count(*)::int AS count
          FROM problems p WHERE ${inRange(start, end)} GROUP BY 1
        `),
      ]);

      const total = current.reduce((sum, row) => sum + row.count, 0);
      const share = (n: number) => (total > 0 ? round((n / total) * 100) : 0);
      const totalBuckets = bucketStarts(period).length;
      const previousOf = new Map(previous.map((row) => [row.category, row.count]));
      const currentOf = new Map(current.map((row) => [row.category, row]));
      const keys = [...new Set([...currentOf.keys(), ...previousOf.keys()])];

      const categories: CategoryRow[] = keys
        .map((category) => {
          const count = currentOf.get(category)?.count ?? 0;
          const before = previousOf.get(category) ?? 0;
          const change = changePct(count, before);
          const buckets = currentOf.get(category)?.buckets ?? 0;
          return {
            category: category as ProblemCategory,
            count,
            share: share(count),
            previous: before,
            changePct: change,
            direction: direction(change),
            persistent: totalBuckets >= 4 && buckets / totalBuckets >= 0.75,
          };
        })
        .sort((a, b) => b.count - a.count || b.previous - a.previous);

      const severityOf = new Map(severity.map((row) => [row.severity, row.count]));
      const tierOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNASSESSED'];
      return {
        ...this.envelope(ctx),
        total,
        categories,
        subcategories: subcategories.map((row) => ({
          category: row.category as ProblemCategory,
          subcategory: row.subcategory,
          count: row.count,
          share: share(row.count),
        })),
        severity: [...PROBLEM_SEVERITIES].reverse().map((level) => ({
          severity: level,
          count: severityOf.get(level) ?? 0,
          share: share(severityOf.get(level) ?? 0),
        })),
        priority: priority
          .sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier))
          .map((row) => ({
            tier: row.tier as PriorityTier | 'UNASSESSED',
            count: row.count,
            share: share(row.count),
          })),
      };
    });
  }

  // ------------------------------------------------------------------- areas

  areas(ctx: GovernmentAnalyticsContext): Promise<AnalyticsAreas> {
    return this.cached(ctx, 'areas', async () => {
      const { start, end } = ctx.resolved;
      const grouped = (name: Prisma.Sql, key: Prisma.Sql, column: Prisma.Sql) =>
        this.prisma.$queryRaw<
          Array<{ name: string; count: number; open: number; resolved: number }>
        >(
          Prisma.sql`
            SELECT ${name} AS name,
                   count(*)::int AS count,
                   count(*) FILTER (WHERE p.status IN ${OPEN})::int AS open,
                   count(*) FILTER (WHERE p.status = 'RESOLVED')::int AS resolved
            FROM problems p
            WHERE ${ctx.where}
              AND p."createdAt" >= ${start} AND p."createdAt" < ${end}
              AND ${column} IS NOT NULL AND trim(${column}) <> ''
            GROUP BY ${key}
            ORDER BY 2 DESC, 1
            LIMIT 50
          `,
        );
      const [states, cities, postal, total] = await Promise.all([
        grouped(
          Prisma.sql`min(trim(p.state))`,
          Prisma.sql`lower(trim(p.state))`,
          Prisma.sql`p.state`,
        ),
        grouped(
          Prisma.sql`min(trim(p.city))`,
          Prisma.sql`lower(trim(p.city))`,
          Prisma.sql`p.city`,
        ),
        grouped(
          Prisma.sql`upper(replace(p."postalCode", ' ', ''))`,
          Prisma.sql`upper(replace(p."postalCode", ' ', ''))`,
          Prisma.sql`p."postalCode"`,
        ),
        this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
          SELECT count(*)::int AS count FROM problems p
          WHERE ${ctx.where} AND p."createdAt" >= ${start} AND p."createdAt" < ${end}
        `),
      ]);
      const view = ctx.scope.jurisdiction.view;
      return {
        ...this.envelope(ctx),
        jurisdiction: {
          name: view.name ?? ctx.scope.organization.name,
          type: view.type ?? view.basis,
          count: total[0]?.count ?? 0,
        },
        byState: suppress(states),
        byCity: suppress(cities),
        byPostalCode: suppress(postal),
        minGroupSize: ANALYTICS_MIN_GROUP_SIZE,
      };
    });
  }

  // -------------------------------------------------------------- resolution

  resolution(ctx: GovernmentAnalyticsContext): Promise<AnalyticsResolution> {
    return this.cached(ctx, 'resolution', async () => {
      const { start, end } = ctx.resolved;
      const stageSql: Record<StageDuration['key'], Prisma.Sql> = {
        review: span('reported_at', 'review_at'),
        verification: span('COALESCE(review_at, reported_at)', 'verified_at'),
        allocation: span('verified_at', 'allocated_at'),
        acceptance: span('allocated_at', 'accepted_at'),
        execution: Prisma.sql`CASE WHEN status = 'RESOLVED' THEN ${span('accepted_at', 'resolved_at')} END`,
      };
      const stageKeys = Object.keys(stageSql) as Array<StageDuration['key']>;
      const stageColumns = Prisma.join(
        stageKeys.map(
          (key) => Prisma.sql`
            avg(${stageSql[key]})::float8 AS ${Prisma.raw(`"${key}_avg"`)},
            ${median(stageSql[key])}::float8 AS ${Prisma.raw(`"${key}_med"`)},
            count(${stageSql[key]})::int AS ${Prisma.raw(`"${key}_n"`)}`,
        ),
        ',',
      );
      const distributionColumns = Prisma.join(
        DURATION_BUCKETS.map(
          ({ min, max }, i) => Prisma.sql`
            count(*) FILTER (WHERE ${RESOLUTION_DAYS} >= ${min}
              ${Number.isFinite(max) ? Prisma.sql`AND ${RESOLUTION_DAYS} < ${max}` : Prisma.empty})::int
              AS ${Prisma.raw(`"d${i}"`)}`,
        ),
        ',',
      );

      const [[row], groups, [longest], [returned]] = await Promise.all([
        this.prisma.$queryRaw<Row[]>(Prisma.sql`
          ${timeline(ctx.where, start, end)},
          f AS (
            SELECT t.*,
                   (status = 'RESOLVED') AS resolved_f,
                   (status IN ('RESOLVED','IN_PROGRESS') OR in_progress_at IS NOT NULL) AS inprog_f
            FROM t
          ),
          g AS (SELECT f.*, (inprog_f OR allocated_at IS NOT NULL) AS alloc_f FROM f),
          h AS (SELECT g.*, (alloc_f OR verified_f) AS ver_f FROM g)
          SELECT
            count(*)::int AS submitted,
            count(*) FILTER (
              WHERE ver_f OR review_at IS NOT NULL OR status IN ('UNDER_REVIEW','REJECTED')
            )::int AS review,
            count(*) FILTER (WHERE ver_f)::int      AS verified,
            count(*) FILTER (WHERE alloc_f)::int    AS allocated,
            count(*) FILTER (WHERE inprog_f)::int   AS "inProgress",
            count(*) FILTER (WHERE resolved_f)::int AS resolved,
            count(*) FILTER (WHERE verified_f)::int AS "verifiedNow",
            avg(${RESOLUTION_DAYS})::float8          AS "resAvg",
            ${median(RESOLUTION_DAYS)}::float8       AS "resMed",
            min(${RESOLUTION_DAYS})::float8          AS "resMin",
            count(${RESOLUTION_DAYS})::int           AS "resN",
            ${stageColumns},
            ${distributionColumns}
          FROM h
        `),
        this.prisma.$queryRaw<Row[]>(Prisma.sql`
          ${timeline(ctx.where, start, end)}
          SELECT 'tier' AS dim, COALESCE(tier, 'UNASSESSED') AS key,
                 count(*)::int AS count,
                 count(*) FILTER (WHERE verified_f)::int AS verified,
                 count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
                 ${median(RESOLUTION_DAYS)}::float8 AS med,
                 count(${RESOLUTION_DAYS})::int AS n,
                 count(*) FILTER (WHERE status IN ${OPEN})::int AS open
          FROM t GROUP BY 2
          UNION ALL
          SELECT 'severity', severity, count(*)::int,
                 count(*) FILTER (WHERE verified_f)::int,
                 count(*) FILTER (WHERE status = 'RESOLVED')::int,
                 ${median(RESOLUTION_DAYS)}::float8,
                 count(${RESOLUTION_DAYS})::int,
                 count(*) FILTER (WHERE status IN ${OPEN})::int
          FROM t GROUP BY 2
        `),
        // Snapshot: the oldest problem still open now, within the filters.
        this.prisma.$queryRaw<Array<{ days: number | null }>>(Prisma.sql`
          SELECT max(EXTRACT(EPOCH FROM (${new Date()} - p."createdAt")) / 86400.0)::float8 AS days
          FROM problems p WHERE ${ctx.where} AND p.status IN ${OPEN}
        `),
        this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
          SELECT count(*)::int AS count
          FROM resolution_verification_requests r
          JOIN problems p ON p.id = r."problemId"
          WHERE r."governmentOrganizationId" = ${ctx.scope.organization.id}::uuid
            AND r.status IN ('REJECTED','MORE_EVIDENCE_REQUESTED')
            AND r."decidedAt" >= ${start} AND r."decidedAt" < ${end}
            AND ${ctx.where}
        `),
      ]);

      const stages: StageDuration[] = stageKeys.map((key) => {
        const n = num(row[`${key}_n`]);
        return {
          key,
          label: STAGE_LABELS[key],
          avgDays: enoughDays(maybe(row[`${key}_avg`]), n),
          medianDays: enoughDays(maybe(row[`${key}_med`]), n),
          observations: n,
        };
      });
      const resN = num(row.resN);
      const tiers = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNASSESSED'];

      return {
        ...this.envelope(ctx),
        summary: {
          avgDays: enoughDays(maybe(row.resAvg), resN),
          medianDays: enoughDays(maybe(row.resMed), resN),
          fastestDays: enoughDays(maybe(row.resMin), resN),
          longestOpenDays:
            longest?.days == null ? null : round(Math.max(0, longest.days)),
          resolutionRate: ratePct(num(row.resolved), num(row.verifiedNow)),
          returnedVerifications: returned?.count ?? 0,
        },
        funnel: funnel({
          submitted: num(row.submitted),
          review: num(row.review),
          verified: num(row.verified),
          allocated: num(row.allocated),
          inProgress: num(row.inProgress),
          resolved: num(row.resolved),
        }),
        stages,
        bottleneck: bottleneck(stages),
        distribution: DURATION_BUCKETS.map(({ label }, i) => ({
          bucket: label,
          count: num(row[`d${i}`]),
        })),
        byPriority: groups
          .filter((g) => g.dim === 'tier')
          .sort((a, b) => tiers.indexOf(String(a.key)) - tiers.indexOf(String(b.key)))
          .map((g) => ({
            tier: g.key as PriorityTier | 'UNASSESSED',
            count: num(g.count),
            resolved: num(g.resolved),
            resolutionRate: ratePct(num(g.resolved), num(g.verified)),
            medianDays: enoughDays(maybe(g.med), num(g.n)),
            openNow: num(g.open),
          })),
        bySeverity: groups
          .filter((g) => g.dim === 'severity')
          .sort(
            (a, b) =>
              PROBLEM_SEVERITIES.indexOf(b.key as ProblemSeverity) -
              PROBLEM_SEVERITIES.indexOf(a.key as ProblemSeverity),
          )
          .map((g) => ({
            severity: g.key as ProblemSeverity,
            count: num(g.count),
            resolved: num(g.resolved),
            resolutionRate: ratePct(num(g.resolved), num(g.verified)),
            medianDays: enoughDays(maybe(g.med), num(g.n)),
          })),
      };
    });
  }

  // --------------------------------------------------------------- community

  /** Community participation in the jurisdiction, from the Prompt 23 ledger. */
  community(ctx: GovernmentAnalyticsContext): Promise<AnalyticsCommunity> {
    return this.cached(ctx, 'community', async () => {
      const { start, end } = ctx.resolved;
      const [[ledger], [outcome]] = await Promise.all([
        this.prisma.$queryRaw<Row[]>(Prisma.sql`
          SELECT count(DISTINCT l."userId")::int AS contributors,
                 COALESCE(sum(l.amount) FILTER (
                   WHERE l.amount > 0 AND l.type <> 'ADMIN_ADJUSTMENT'
                 ), 0)::int AS points,
                 count(*) FILTER (
                   WHERE l.type::text = ANY (${[...RESOLUTION_TYPES]}::text[])
                 )::int AS contributions
          FROM impact_point_transactions l
          JOIN problems p ON p.id = l."problemId"
          WHERE ${ctx.where}
            AND l."createdAt" >= ${start} AND l."createdAt" < ${end}
        `),
        this.prisma.$queryRaw<Row[]>(Prisma.sql`
          ${timeline(ctx.where, start, end)}
          SELECT count(*)::int AS reported,
                 count(*) FILTER (WHERE verified_f)::int AS verified,
                 count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
                 count(*) FILTER (WHERE status = 'DUPLICATE')::int AS duplicates,
                 (SELECT count(*)::int FROM problems s
                   WHERE s.id IN (SELECT id FROM t) AND s."voteCount" > 0) AS supported,
                 avg(${span('reported_at', 'verified_at')})::float8 AS "toVer",
                 count(${span('reported_at', 'verified_at')})::int AS "toVerN",
                 avg(CASE WHEN status = 'RESOLVED' THEN ${span('verified_at', 'resolved_at')} END)::float8
                   AS "verToRes",
                 count(CASE WHEN status = 'RESOLVED' THEN ${span('verified_at', 'resolved_at')} END)::int
                   AS "verToResN"
          FROM t
        `),
      ]);
      return {
        ...this.envelope(ctx),
        activeContributors: num(ledger.contributors),
        reported: num(outcome.reported),
        verifiedReports: num(outcome.verified),
        confirmedDuplicates: num(outcome.duplicates),
        communitySupported: num(outcome.supported),
        contributionsToResolution: num(ledger.contributions),
        impactPointsEarned: num(ledger.points),
        outcome: {
          reports: num(outcome.reported),
          verified: num(outcome.verified),
          resolved: num(outcome.resolved),
          avgDaysReportToVerification: enoughDays(
            maybe(outcome.toVer),
            num(outcome.toVerN),
          ),
          avgDaysVerificationToResolution: enoughDays(
            maybe(outcome.verToRes),
            num(outcome.verToResN),
          ),
        },
      };
    });
  }

  // ---------------------------------------------------------------- hotspots

  /**
   * Deterministic hotspots (`grid-zscore-v1`): problems are counted on a
   * fixed ~0.55 km grid, weighted by severity and recency, and a cell is a
   * hotspot when its weighted density is ≥ 2 standard deviations above the
   * other occupied cells' and it holds ≥ 3 problems. Cells below the minimum
   * group size are not returned; centroids are rounded to ~100 m.
   */
  hotspots(ctx: GovernmentAnalyticsContext): Promise<AnalyticsHotspots> {
    return this.cached(ctx, 'hotspots', async () => {
      const { start, end } = ctx.resolved;
      const deg = HOTSPOT_CELL_DEGREES;
      const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT floor(p.longitude / ${deg})::int AS cx,
               floor(p.latitude / ${deg})::int  AS cy,
               p.category::text AS category,
               count(*)::int AS count,
               count(*) FILTER (WHERE p.status IN ${OPEN})::int AS open,
               sum(
                 (CASE p.severity WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'HIGH' THEN 3 ELSE 4 END)
                 * power(0.5, GREATEST(0, EXTRACT(EPOCH FROM (${end} - p."createdAt")) / 86400.0)
                     / ${HOTSPOT_HALF_LIFE_DAYS})
               )::float8 AS weighted,
               count(*) FILTER (WHERE p.severity = 'LOW')::int      AS "LOW",
               count(*) FILTER (WHERE p.severity = 'MEDIUM')::int   AS "MEDIUM",
               count(*) FILTER (WHERE p.severity = 'HIGH')::int     AS "HIGH",
               count(*) FILTER (WHERE p.severity = 'CRITICAL')::int AS "CRITICAL",
               sum(p.latitude)::float8  AS lat,
               sum(p.longitude)::float8 AS lng,
               mode() WITHIN GROUP (ORDER BY p.city) AS city
        FROM problems p
        WHERE ${ctx.where} AND p."createdAt" >= ${start} AND p."createdAt" < ${end}
        GROUP BY 1, 2, 3
      `);

      interface Cell extends CellAggregate {
        severity: Record<ProblemSeverity, number>;
        categories: Map<ProblemCategory, number>;
        latSum: number;
        lngSum: number;
      }
      const cells = new Map<string, Cell>();
      for (const row of rows) {
        const id = `${row.cx}:${row.cy}`;
        const cell =
          cells.get(id) ??
          ({
            cellX: num(row.cx),
            cellY: num(row.cy),
            latitude: 0,
            longitude: 0,
            label: null,
            count: 0,
            open: 0,
            weighted: 0,
            topCategory: null,
            severity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
            categories: new Map(),
            latSum: 0,
            lngSum: 0,
          } satisfies Cell);
        const count = num(row.count);
        cell.count += count;
        cell.open += num(row.open);
        cell.weighted += num(row.weighted);
        cell.latSum += num(row.lat);
        cell.lngSum += num(row.lng);
        cell.label ??= (row.city as string | null) ?? null;
        for (const level of PROBLEM_SEVERITIES) cell.severity[level] += num(row[level]);
        cell.categories.set(row.category as ProblemCategory, count);
        cells.set(id, cell);
      }
      const all = [...cells.values()].map((cell) => {
        const ranked = [...cell.categories.entries()].sort((a, b) => b[1] - a[1]);
        return {
          ...cell,
          latitude: round(cell.latSum / cell.count, 3),
          longitude: round(cell.lngSum / cell.count, 3),
          topCategory: ranked[0]?.[0] ?? null,
          ranked,
        };
      });

      const { scored, enoughCells } = scoreHotspots(all);
      const visible = all
        .filter((cell) => cell.count >= ANALYTICS_MIN_GROUP_SIZE)
        .sort((a, b) => b.count - a.count)
        .slice(0, 500);
      const features: MapAggregateCell[] = visible.map((cell) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [cell.longitude, cell.latitude] },
        properties: {
          count: cell.count,
          severity: cell.severity,
          topCategories: cell.ranked
            .slice(0, 3)
            .map(([category, count]) => ({ category, count })),
        },
      }));

      return {
        ...this.envelope(ctx),
        algorithmVersion: HOTSPOT_ALGORITHM,
        cellSizeKm: round(deg * 111.32, 2),
        cells: features,
        hotspots: scored.filter((cell) => cell.isHotspot).slice(0, 20),
        occupiedCells: all.length,
        note:
          all.length === 0
            ? null
            : enoughCells
              ? null
              : `Hotspots need reports in at least ${HOTSPOT_MIN_CELLS} grid cells to compare against.`,
      };
    });
  }

  // --------------------------------------------------------------- recurring

  /**
   * Recurring problems: the same category reported again and again in one
   * place — at least 3 reports within ~300 m, from at least 2 people, spread
   * over at least 14 days. Confirmed duplicates are excluded, so this is not
   * duplicate detection: a duplicate is one problem reported twice; a
   * recurring problem keeps coming back.
   */
  recurring(ctx: GovernmentAnalyticsContext): Promise<AnalyticsRecurring> {
    return this.cached(ctx, 'recurring', async () => {
      const { period, start, end } = ctx.resolved;
      const tz = period.timezone;
      const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
        WITH c AS (
          SELECT p.id, p."reporterId", p.category::text AS category, p."createdAt",
                 p.status, p.latitude, p.longitude,
                 COALESCE(upper(replace(p."postalCode", ' ', '')), p.city) AS area,
                 ST_ClusterDBSCAN(
                   ST_Transform(p.location::geometry, 3857), ${RECURRING_EPS_M}::float8,
                   ${RECURRING_MIN_POINTS}::int
                 ) OVER (PARTITION BY p.category) AS cluster
          FROM problems p
          WHERE ${ctx.where}
            AND p.status <> 'DUPLICATE'
            AND p.location IS NOT NULL
            AND p."createdAt" >= ${start} AND p."createdAt" < ${end}
        )
        SELECT category,
               count(*)::int AS reports,
               count(DISTINCT "reporterId")::int AS reporters,
               to_char(${trueInstant(Prisma.sql`min("createdAt")`)} AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS first,
               to_char(${trueInstant(Prisma.sql`max("createdAt")`)} AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS last,
               (EXTRACT(EPOCH FROM (max("createdAt") - min("createdAt"))) / 86400.0)::float8 AS span,
               count(*) FILTER (WHERE status IN ${OPEN})::int AS open,
               avg(latitude)::float8 AS lat,
               avg(longitude)::float8 AS lng,
               mode() WITHIN GROUP (ORDER BY area) AS area
        FROM c
        WHERE cluster IS NOT NULL
        GROUP BY category, cluster
        HAVING count(*) >= ${RECURRING_MIN_POINTS}
           AND count(DISTINCT "reporterId") >= ${RECURRING_MIN_REPORTERS}
           AND max("createdAt") - min("createdAt") >= make_interval(days => ${RECURRING_MIN_SPAN_DAYS})
        ORDER BY reports DESC, span DESC
        LIMIT 50
      `);
      return {
        ...this.envelope(ctx),
        algorithmVersion: RECURRING_ALGORITHM,
        clusters: rows.map((row) => ({
          category: row.category as ProblemCategory,
          area: (row.area as string | null) ?? null,
          reports: num(row.reports),
          distinctReporters: num(row.reporters),
          firstReported: String(row.first),
          lastReported: String(row.last),
          spanDays: Math.round(num(row.span)),
          open: num(row.open),
          latitude: round(num(row.lat), 3),
          longitude: round(num(row.lng), 3),
        })),
      };
    });
  }

  // ------------------------------------------------------------------ export

  /**
   * Problem rows for export: public fields only — no coordinates, reporter,
   * notes or allocation reasons. Dates are local to the reporting zone.
   */
  async problemRows(
    ctx: GovernmentAnalyticsContext,
    limit: number,
  ): Promise<{ rows: Row[]; truncated: boolean }> {
    const { period, start, end } = ctx.resolved;
    const tz = period.timezone;
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT p."publicId" AS "problemId",
             p.title,
             p.category::text AS category,
             p.severity::text AS severity,
             p.status::text AS status,
             ${EFFECTIVE_TIER}::text AS priority,
             p.city, p.state, p."postalCode",
             to_char(${trueInstant(Prisma.sql`p."createdAt"`)} AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS "reportedOn",
             to_char(${trueInstant(Prisma.sql`p."resolvedAt"`)} AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS "resolvedOn",
             p."voteCount" AS supporters
      FROM problems p
      WHERE ${ctx.where} AND p."createdAt" >= ${start} AND p."createdAt" < ${end}
      ORDER BY p."createdAt" DESC
      LIMIT ${limit + 1}
    `);
    return { rows: rows.slice(0, limit), truncated: rows.length > limit };
  }

  periodOf(ctx: GovernmentAnalyticsContext): AnalyticsPeriod {
    return ctx.resolved.period;
  }
}

interface PeriodStats {
  reported: number;
  verified: number;
  inProgress: number;
  resolved: number;
  rejected: number;
  criticalHigh: number;
  avgVer: number | null;
  medVer: number | null;
  nVer: number;
  avgRes: number | null;
  medRes: number | null;
  nRes: number;
}
