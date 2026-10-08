import { Injectable } from '@nestjs/common';
import type {
  GovernmentContext,
  GovernmentDashboard,
  GovernmentMetrics,
  TrendPoint,
  TrendRange,
} from '@samadhaan/shared';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { GovernmentScope } from './government-access.service.js';
import { ProjectsService } from '../resolution/projects.service.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { GovernmentProblemsService } from './government-problems.service.js';
import { AppConfig } from '../config/app.config.js';
import {
  addDays,
  bucketSql,
  localDate,
  zonedMidnight,
} from '../analytics/analytics-time.js';

/**
 * The command centre's reads. Every figure is an aggregate computed in
 * PostgreSQL over problems inside the office's jurisdiction; the browser
 * receives totals and a short series, never the problems behind them.
 */
@Injectable()
export class GovernmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly problems: GovernmentProblemsService,
    private readonly allocations: AllocationsService,
    private readonly projects: ProjectsService,
    private readonly config: AppConfig,
  ) {}

  async context(scope: GovernmentScope, userId: string): Promise<GovernmentContext> {
    const viewer = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true, displayName: true },
    });
    const { organization, membership, jurisdiction } = scope;

    return {
      organization: {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        logoUrl: organization.logoUrl,
        verificationStatus: organization.verificationStatus,
        jurisdiction: jurisdiction.view,
      },
      membership: { id: membership.id, membershipRole: membership.membershipRole },
      viewer: {
        name: viewer.fullName,
        firstName: greetingName(viewer.fullName),
      },
      // Every active official of the office reviews and notes. Finer-grained
      // review roles arrive with allocation, where decisions carry more weight.
      permissions: { canReview: true, canAddNotes: true },
    };
  }

  async dashboard(
    scope: GovernmentScope,
    range: TrendRange,
  ): Promise<GovernmentDashboard> {
    const office = { governmentOrganizationId: scope.organization.id };
    const [counts, allocationCounts, points, queue, activity, projects, activeProjects] =
      await Promise.all([
        this.metrics(scope),
        this.allocations.governmentMetrics(scope.organization.id),
        this.trend(scope, range),
        this.problems.list(scope, { view: 'queue', sort: 'queue' }, 1, 6),
        this.problems.audit(scope, { limit: 8 }),
        this.projects.summaries(office),
        this.projects.countLive(office),
      ]);

    return {
      metrics: { ...counts, ...allocationCounts, activeProjects },
      projects,
      trend: { rangeDays: range, points },
      reviewQueue: queue.items,
      recentActivity: activity.map(({ note: _note, ...entry }) => entry),
    };
  }

  /** All counts in one scan of the jurisdiction's problems. */
  async metrics(
    scope: GovernmentScope,
  ): Promise<
    Omit<
      GovernmentMetrics,
      'pendingAllocations' | 'acceptedAllocations' | 'declinedAllocations'
    >
  > {
    const [row] = await this.prisma.$queryRaw<
      Array<Record<keyof GovernmentMetrics, number>>
    >(
      Prisma.sql`
        SELECT
          count(*)::int                                                    AS "totalReports",
          count(*) FILTER (WHERE p.status IN ('SUBMITTED','UNDER_REVIEW'))::int AS "pendingReview",
          count(*) FILTER (WHERE p.status = 'SUBMITTED')::int              AS "submitted",
          count(*) FILTER (WHERE p.status = 'UNDER_REVIEW')::int           AS "underReview",
          count(*) FILTER (WHERE p.status = 'VERIFIED')::int               AS "verified",
          count(*) FILTER (
            WHERE p.severity IN ('HIGH','CRITICAL')
              AND p.status IN ('SUBMITTED','UNDER_REVIEW','VERIFIED','IN_PROGRESS')
          )::int                                                           AS "highSeverityOpen",
          count(*) FILTER (WHERE p.status = 'IN_PROGRESS')::int            AS "inProgress",
          count(*) FILTER (WHERE p.status = 'RESOLVED')::int               AS "resolved",
          count(*) FILTER (WHERE p.status = 'REJECTED')::int               AS "rejected",
          count(*) FILTER (WHERE p.status = 'DUPLICATE')::int              AS "duplicates"
        FROM problems p
        WHERE p."deletedAt" IS NULL
          AND p.status <> 'DRAFT'
          AND ${scope.jurisdiction.condition}
      `,
    );
    return row as Omit<
      GovernmentMetrics,
      'pendingAllocations' | 'acceptedAllocations' | 'declinedAllocations'
    >;
  }

  /**
   * Reports and resolutions per local day over the range — two grouped
   * counts, merged onto a complete list of days so quiet days show as zero
   * rather than vanishing from the chart.
   *
   * Days are the reporting time zone's (ANALYTICS_TIMEZONE), not UTC's: a
   * report filed at 01:00 in Kolkata belongs to that day. The bucketing is
   * shared with the analytics module (Prompt 24).
   */
  async trend(scope: GovernmentScope, range: TrendRange): Promise<TrendPoint[]> {
    const zone = this.config.analytics.timezone;
    const today = localDate(new Date(), zone);
    const first = addDays(today, -(range - 1));
    const start = zonedMidnight(first, zone);

    const grouped = (column: 'createdAt' | 'resolvedAt') =>
      this.prisma.$queryRaw<Array<{ day: string; count: number }>>(Prisma.sql`
        SELECT ${bucketSql(Prisma.sql`p.${Prisma.raw(`"${column}"`)}`, 'day', zone)} AS day,
               count(*)::int AS count
        FROM problems p
        WHERE p."deletedAt" IS NULL
          AND p.status <> 'DRAFT'
          AND p.${Prisma.raw(`"${column}"`)} >= ${start}
          AND ${scope.jurisdiction.condition}
        GROUP BY 1
      `);

    const [reported, resolved] = await Promise.all([
      grouped('createdAt'),
      grouped('resolvedAt'),
    ]);
    const reportedBy = new Map(reported.map((row) => [row.day, row.count]));
    const resolvedBy = new Map(resolved.map((row) => [row.day, row.count]));

    return Array.from({ length: range }, (_, index) => {
      const date = addDays(first, index);
      return {
        date,
        reported: reportedBy.get(date) ?? 0,
        resolved: resolvedBy.get(date) ?? 0,
      };
    });
  }
}

/**
 * What to greet an official by: their first name, unless it is only an
 * initial ("S. Krishnan"), in which case the whole name.
 */
export function greetingName(fullName: string): string {
  const name = fullName.trim();
  const first = name.split(/\s+/)[0] ?? name;
  return first.replace(/\.$/, '').length <= 1 ? name.replace(/\.$/, '') : first;
}
