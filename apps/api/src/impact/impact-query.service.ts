import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  IMPACT_FILTER_TYPES,
  type ContributionView,
  type ImpactFilter,
  type ImpactSummary,
  type ImpactTransactionType,
  type LeaderboardEntryView,
  type LeaderboardPage,
  type LeaderboardPeriod,
  type ProblemCategory,
  type ReputationTier,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { RedisService } from '../redis/redis.service.js';
import { RESOLUTION_TYPES, idempotencyKey } from './impact-rules.js';
import { ImpactLedgerService } from './impact-ledger.service.js';

const PERIOD_DAYS: Record<LeaderboardPeriod, number | null> = {
  week: 7,
  month: 30,
  year: 365,
  all: null,
};

interface RankedRow {
  userId: string;
  points: number;
  rank: number;
  displayName: string | null;
  fullName: string;
  avatarUrl: string | null;
  reputationScore: Prisma.Decimal | null;
  reputationTier: ReputationTier | null;
  resolvedContributions: number | null;
}

/**
 * Reading impact (Prompt 23): a user's own ledger and contributions, the
 * public leaderboard, and the one write a person may make — an administrator's
 * audited adjustment.
 *
 * The leaderboard is aggregated in SQL (indexed; ranked with a window
 * function; paginated) — never by loading transactions into Node. All-time
 * without filters reads the maintained `user_impact_stats`; periods and
 * filters aggregate the ledger, joined to problems for city, state and
 * category. Public pages are cached briefly; they contain only public names.
 */
@Injectable()
export class ImpactQueryService {
  private readonly logger = new Logger(ImpactQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ledger: ImpactLedgerService,
    private readonly config: AppConfig,
  ) {}

  async summary(
    userId: string,
    filter: ImpactFilter,
    page: number,
    limit: number,
  ): Promise<ImpactSummary> {
    const where: Prisma.ImpactPointTransactionWhereInput = {
      userId,
      ...(filter === 'all' ? {} : { type: { in: [...IMPACT_FILTER_TYPES[filter]] } }),
    };
    const [stats, rows, totalCount] = await Promise.all([
      this.prisma.userImpactStats.findUnique({ where: { userId } }),
      this.prisma.impactPointTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.impactPointTransaction.count({ where }),
    ]);
    const problems = await this.problems(rows.map((r) => r.problemId));
    return {
      impactPoints: stats?.impactPoints ?? 0,
      resolvedContributions: stats?.resolvedContributions ?? 0,
      tier: (stats?.reputationTier ?? 'NEW_CONTRIBUTOR') as ReputationTier,
      items: rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        type: r.type as ImpactTransactionType,
        reason: r.reason,
        problem: r.problemId ? (problems.get(r.problemId) ?? null) : null,
        ruleVersion: r.ruleVersion,
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    };
  }

  async contributions(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    items: ContributionView[];
    page: number;
    totalCount: number;
    totalPages: number;
  }> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        problemId: string;
        roles: string[];
        points: number;
        publicId: string;
        title: string;
        category: ProblemCategory;
        city: string | null;
        resolvedAt: Date | null;
      }>
    >`
      SELECT t."problemId", array_agg(DISTINCT t.type::text) AS roles, sum(t.amount)::int AS points,
             p."publicId", p.title, p.category::text AS category, p.city, p."resolvedAt"
      FROM impact_point_transactions t
      JOIN problems p ON p.id = t."problemId" AND p."deletedAt" IS NULL
      WHERE t."userId" = ${userId}::uuid AND t.type::text = ANY (${[...RESOLUTION_TYPES]}::text[])
      GROUP BY t."problemId", p."publicId", p.title, p.category, p.city, p."resolvedAt"
      ORDER BY p."resolvedAt" DESC NULLS LAST, p."publicId"
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `;
    const [count] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(DISTINCT t."problemId")::int AS n FROM impact_point_transactions t
      JOIN problems p ON p.id = t."problemId" AND p."deletedAt" IS NULL
      WHERE t."userId" = ${userId}::uuid AND t.type::text = ANY (${[...RESOLUTION_TYPES]}::text[])
    `;
    const totalCount = count?.n ?? 0;
    return {
      items: rows.map((r) => ({
        problem: {
          publicId: r.publicId,
          title: r.title,
          category: r.category,
          city: r.city,
        },
        roles: r.roles as ImpactTransactionType[],
        points: r.points,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
      })),
      page,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / Math.max(1, limit))),
    };
  }

  // ------------------------------------------------------------ leaderboard

  async leaderboard(
    params: {
      period: LeaderboardPeriod;
      city?: string;
      state?: string;
      category?: ProblemCategory;
      page: number;
      limit: number;
    },
    viewer: RequestUser | null,
  ): Promise<LeaderboardPage> {
    const cacheSeconds = this.config.impact.leaderboardCacheSeconds;
    const key = `leaderboard:v1:${createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 32)}`;
    // Cached: public entries plus the internal ids needed to mark the viewer's
    // row. Ids never leave the server.
    type Cached = Omit<LeaderboardPage, 'viewer' | 'items'> & {
      rows: Array<{ userId: string; entry: LeaderboardEntryView }>;
    };
    let cached: Cached | null = null;
    if (cacheSeconds > 0) {
      const hit = await this.redis.connection.get(key).catch(() => null);
      if (hit) cached = JSON.parse(hit) as Cached;
    }
    if (!cached) {
      const ranked = this.ranked(params);
      const [rows, count] = await Promise.all([
        this.prisma.$queryRaw<RankedRow[]>(Prisma.sql`
          ${ranked} SELECT * FROM ranked ORDER BY rank, "userId"
          LIMIT ${params.limit} OFFSET ${(params.page - 1) * params.limit}`),
        this.prisma.$queryRaw<Array<{ n: number }>>(
          Prisma.sql`${ranked} SELECT count(*)::int AS n FROM ranked`,
        ),
      ]);
      const totalCount = count[0]?.n ?? 0;
      const entries = await this.entries(rows, null);
      cached = {
        period: params.period,
        filters: {
          city: params.city ?? null,
          state: params.state ?? null,
          category: params.category ?? null,
        },
        rows: rows.map((r, i) => ({ userId: r.userId, entry: entries[i]! })),
        page: params.page,
        limit: params.limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / params.limit)),
        generatedAt: new Date().toISOString(),
      };
      if (cacheSeconds > 0) {
        await this.redis.connection
          .set(key, JSON.stringify(cached), 'EX', cacheSeconds)
          .catch(() => undefined);
      }
    }
    let viewerRow: LeaderboardEntryView | null = null;
    if (viewer) {
      const mine = await this.prisma.$queryRaw<RankedRow[]>(Prisma.sql`
        ${this.ranked(params)} SELECT * FROM ranked WHERE "userId" = ${viewer.id}::uuid`);
      viewerRow = mine.length ? (await this.entries(mine, viewer.id))[0]! : null;
    }
    const { rows, ...rest } = cached;
    return {
      ...rest,
      items: rows.map(({ userId, entry }) => ({
        ...entry,
        isViewer: viewer !== null && userId === viewer.id,
      })),
      viewer: viewerRow,
    };
  }

  /** The ranked set as a CTE: public, active accounts with positive points under the filters. */
  private ranked(params: {
    period: LeaderboardPeriod;
    city?: string;
    state?: string;
    category?: ProblemCategory;
  }): Prisma.Sql {
    const days = PERIOD_DAYS[params.period];
    const filtered = Boolean(params.city || params.state || params.category);
    const people = Prisma.sql`
      JOIN users u ON u.id = x."userId" AND u."deletedAt" IS NULL AND u.status = 'ACTIVE'
      LEFT JOIN user_impact_stats s ON s."userId" = x."userId"`;
    if (days === null && !filtered) {
      return Prisma.sql`WITH x AS (
          SELECT "userId", "impactPoints" AS points FROM user_impact_stats WHERE "impactPoints" > 0
        ), ranked AS (
          SELECT x."userId", x.points, RANK() OVER (ORDER BY x.points DESC)::int AS rank,
                 u."displayName", u."fullName", u."avatarUrl",
                 s."reputationScore", s."reputationTier"::text AS "reputationTier", s."resolvedContributions"
          FROM x ${people}
        )`;
    }
    const conditions: Prisma.Sql[] = [];
    if (days !== null)
      conditions.push(
        Prisma.sql`t."createdAt" >= ${new Date(Date.now() - days * 86_400_000)}`,
      );
    if (params.city) conditions.push(Prisma.sql`lower(p.city) = lower(${params.city})`);
    if (params.state)
      conditions.push(Prisma.sql`lower(p.state) = lower(${params.state})`);
    if (params.category)
      conditions.push(Prisma.sql`p.category = ${params.category}::"ProblemCategory"`);
    const join = filtered
      ? Prisma.sql`JOIN problems p ON p.id = t."problemId"`
      : Prisma.empty;
    return Prisma.sql`WITH x AS (
        SELECT t."userId", sum(t.amount)::int AS points
        FROM impact_point_transactions t ${join}
        WHERE ${conditions.length ? Prisma.join(conditions, ' AND ') : Prisma.sql`true`}
        GROUP BY t."userId" HAVING sum(t.amount) > 0
      ), ranked AS (
        SELECT x."userId", x.points, RANK() OVER (ORDER BY x.points DESC)::int AS rank,
               u."displayName", u."fullName", u."avatarUrl",
               s."reputationScore", s."reputationTier"::text AS "reputationTier", s."resolvedContributions"
        FROM x ${people}
      )`;
  }

  /** Public fields only: name, handle, avatar. Never email, phone or account data. */
  private async entries(
    rows: RankedRow[],
    viewerId: string | null,
  ): Promise<LeaderboardEntryView[]> {
    const badges = rows.length
      ? await this.prisma.userBadge.findMany({
          where: { userId: { in: rows.map((r) => r.userId) } },
          include: { badge: { select: { name: true, sortOrder: true } } },
        })
      : [];
    return rows.map((r) => ({
      rank: r.rank,
      user: {
        displayName: r.displayName,
        name: r.displayName ?? r.fullName,
        avatarUrl: r.avatarUrl,
      },
      impactPoints: r.points,
      reputationScore:
        r.reputationScore === null ? 0 : Math.round(Number(r.reputationScore)),
      reputationTier: r.reputationTier ?? 'NEW_CONTRIBUTOR',
      resolvedContributions: r.resolvedContributions ?? 0,
      badges: badges
        .filter((b) => b.userId === r.userId)
        .sort((a, b) => b.badge.sortOrder - a.badge.sortOrder)
        .slice(0, 3)
        .map((b) => ({ key: b.badgeKey, name: b.badge.name })),
      isViewer: viewerId !== null && r.userId === viewerId,
    }));
  }

  // ------------------------------------------------------------ admin

  /** An administrator's correction: a new, audited transaction — never an edit. */
  async adjust(
    targetUserId: string,
    amount: number,
    reason: string,
    admin: RequestUser,
  ): Promise<{ impactPoints: number }> {
    if (targetUserId === admin.id)
      throw AppException.forbidden('Administrators cannot adjust their own points.');
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, deletedAt: true },
    });
    if (!target || target.deletedAt) throw AppException.notFound('User');
    const adjustmentId = randomUUID();
    await this.ledger.award([
      {
        userId: targetUserId,
        type: 'ADMIN_ADJUSTMENT',
        amount,
        reason,
        entityType: 'User',
        entityId: targetUserId,
        problemId: null,
        idempotencyKey: idempotencyKey('ADMIN_ADJUSTMENT', adjustmentId, targetUserId),
        actorUserId: admin.id,
        metadata: { adjustmentId },
      },
    ]);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: admin.id,
        action: 'IMPACT_POINTS_ADJUSTED',
        entityType: 'User',
        entityId: targetUserId,
        metadata: { amount, reason, adjustmentId },
      },
    });
    this.logger.log(
      `Impact adjustment ${amount} for ${targetUserId} by admin ${admin.id}`,
    );
    const stats = await this.prisma.userImpactStats.findUnique({
      where: { userId: targetUserId },
    });
    return { impactPoints: stats?.impactPoints ?? 0 };
  }

  private async problems(
    ids: Array<string | null>,
  ): Promise<Map<string, { publicId: string; title: string }>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.problem.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true, publicId: true, title: true },
    });
    return new Map(rows.map((r) => [r.id, { publicId: r.publicId, title: r.title }]));
  }
}
