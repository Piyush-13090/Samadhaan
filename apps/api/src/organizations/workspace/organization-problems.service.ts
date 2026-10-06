import { Injectable } from '@nestjs/common';
import {
  ACTIVE_PROBLEM_STATUSES,
  ORGANIZATION_SERVICE_RADIUS_METERS,
  type ExpertiseLevel,
  type MatchStatus,
  type RecommendationPage,
  type RecommendationSort,
  type RecommendationView,
  type OrganizationProblemItem,
  type OrganizationProblemPage,
  type ProblemCategory,
  type ProblemSeverity,
  type ProblemStatus,
  type ProblemUrgency,
  type RelevanceReason,
  type WorkspaceProblemScope,
  type WorkspaceProblemSort,
} from '@samadhaan/shared';
import { AppException } from '../../common/app.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  Prisma,
  type Organization,
  type OrganizationExpertise,
} from '../../generated/prisma/client.js';
import { coarseArea } from '../../problems/services/problem-discovery.service.js';
import { toMatchEvidence } from '../../matching/match.serializer.js';
import { StorageService } from '../../storage/storage.types.js';

/**
 * Weight of a declared expertise level, used only to order results. A
 * specialist's categories come before an interested party's.
 */
const LEVEL_TIER: Record<ExpertiseLevel, number> = {
  SPECIALIST: 3,
  EXPERIENCED: 2,
  INTERESTED: 1,
};

/** The filters a listing can apply. All optional. */
export interface WorkspaceProblemFilters {
  scope: WorkspaceProblemScope;
  sort: WorkspaceProblemSort;
  category?: ProblemCategory;
  subcategory?: string;
  severity?: ProblemSeverity;
  status?: ProblemStatus;
  city?: string;
  /** Measured from the organisation's registered location. */
  radiusMeters?: number;
  reportedWithinDays?: number;
  /** Internal: newest problems in the service area, any category. */
  serviceAreaOnly?: boolean;
}

interface Row {
  publicId: string;
  title: string;
  category: ProblemCategory;
  subcategory: string | null;
  status: ProblemStatus;
  severity: ProblemSeverity;
  urgency: ProblemUrgency;
  address: string | null;
  city: string | null;
  voteCount: number;
  commentCount: number;
  createdAt: Date;
  reporterId: string;
  thumbnailKey: string | null;
  supportedByViewer: boolean;
  followedByViewer: boolean;
  distanceMeters: number | null;
  expertiseLevel: ExpertiseLevel | null;
  subcategoryMatch: boolean;
  areaMatch: boolean;
  aiStatus: string | null;
  aiCategory: ProblemCategory | null;
  aiSubcategory: string | null;
  aiSeverity: ProblemSeverity | null;
  aiConfidence: Prisma.Decimal | string | null;
  // Present only on recommendation queries.
  matchStatus?: MatchStatus;
  semanticScore?: number | null;
  expertiseScore?: number | null;
  categoryScore?: number | null;
  geographicScore?: number | null;
  capabilityScore?: number | null;
  activityScore?: number | null;
  finalScore?: number;
  matchRank?: number;
  explanation?: unknown;
  matchUpdatedAt?: Date;
}

/** Restricts a listing to this organisation's AI matches (Prompt 14). */
interface MatchJoin {
  organizationId: string;
  statuses: MatchStatus[];
  minRelevance?: number;
}

export interface RecommendationFilters {
  sort: RecommendationSort;
  view: RecommendationView;
  category?: ProblemCategory;
  severity?: ProblemSeverity;
  city?: string;
  radiusMeters?: number;
  reportedWithinDays?: number;
  minRelevance?: number;
}

/** Everything about the organisation a query needs, resolved once. */
interface QueryContext {
  expertise: Prisma.Sql;
  origin: Prisma.Sql | null;
  areaMatch: Prisma.Sql;
  hasCoordinates: boolean;
}

/**
 * Problem discovery for an organisation's workspace.
 *
 * **Deterministic and explainable.** A problem surfaces because of facts a
 * member can check against their own profile — its category is one of their
 * areas of work, it is within their service area, it is severe, it is recent.
 * There is no model, no score and no LLM in the rules here. The AI matching
 * engine (Prompt 14) writes `organization_problem_matches`;
 * `listRecommended` only reads them, through the same filters.
 *
 * As with the citizen feed, everything is decided in SQL: filtering, the
 * relevance order, the page boundary and the count. Node receives one page.
 */
@Injectable()
export class OrganizationProblemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** One page of problems for `organization`. */
  async list(
    organization: Organization,
    viewerId: string,
    filters: WorkspaceProblemFilters,
    page: number,
    limit: number,
  ): Promise<OrganizationProblemPage> {
    const {
      rows,
      page: result,
      context,
    } = await this.query(organization, viewerId, filters, page, limit, null);
    const items = await Promise.all(
      rows.map((row) => this.toItem(row, viewerId, context.hasCoordinates)),
    );
    return { ...result, items };
  }

  /**
   * One page of this organisation's AI recommendations (Prompt 14): the same
   * visibility rules, filters and card shape as `list`, restricted to problems
   * the matching engine scored for this organisation, ordered by relevance.
   */
  async listRecommended(
    organization: Organization,
    viewerId: string,
    filters: RecommendationFilters,
    page: number,
    limit: number,
  ): Promise<RecommendationPage> {
    const sort: WorkspaceProblemSort = filters.sort;
    const {
      rows,
      page: result,
      context,
    } = await this.query(
      organization,
      viewerId,
      {
        scope: 'all',
        sort,
        category: filters.category,
        severity: filters.severity,
        city: filters.city,
        radiusMeters: filters.radiusMeters,
        reportedWithinDays: filters.reportedWithinDays,
      },
      page,
      limit,
      {
        organizationId: organization.id,
        statuses: filters.view === 'dismissed' ? ['DISMISSED'] : ['CALCULATED', 'STALE'],
        minRelevance: filters.minRelevance,
      },
    );

    const items = await Promise.all(
      rows.map(async (row) => ({
        ...(await this.toItem(row, viewerId, context.hasCoordinates)),
        match: {
          ...toMatchEvidence({
            semanticScore: row.semanticScore ?? null,
            expertiseScore: row.expertiseScore ?? null,
            categoryScore: row.categoryScore ?? null,
            geographicScore: row.geographicScore ?? null,
            capabilityScore: row.capabilityScore ?? null,
            activityScore: row.activityScore ?? null,
            finalScore: Number(row.finalScore ?? 0),
            rank: row.matchRank ?? 0,
            explanation: row.explanation,
            updatedAt: row.matchUpdatedAt ?? new Date(0),
          }),
          status: row.matchStatus ?? 'CALCULATED',
        },
      })),
    );
    return { ...result, items };
  }

  private async query(
    organization: Organization,
    viewerId: string,
    filters: WorkspaceProblemFilters,
    page: number,
    limit: number,
    match: MatchJoin | null,
  ): Promise<{
    rows: Row[];
    page: Omit<OrganizationProblemPage, 'items'>;
    context: QueryContext;
  }> {
    const context = await this.contextFor(organization);

    if (
      (filters.radiusMeters !== undefined || filters.sort === 'distance') &&
      !context.origin
    ) {
      throw AppException.badRequest(
        "Add your organisation's location in Settings to filter or sort by distance.",
      );
    }

    const conditions = [this.conditions(context, filters)];
    if (match?.minRelevance !== undefined) {
      conditions.push(
        Prisma.sql`m."finalScore" >= ${match.minRelevance}::double precision`,
      );
    }
    const where = Prisma.join(conditions, ' AND ');

    // The match join, when listing recommendations. An inner join: only
    // problems the engine scored for this organisation, in the wanted states.
    const matchJoin = match
      ? Prisma.sql`JOIN organization_problem_matches m
          ON m."problemId" = p."id"
         AND m."organizationId" = ${match.organizationId}::uuid
         AND m."status" = ANY (${match.statuses}::"OrganizationMatchStatus"[])`
      : Prisma.empty;
    const matchColumns = match
      ? Prisma.sql`,
          m."status"::text             AS "matchStatus",
          m."semanticScore"            AS "semanticScore",
          m."expertiseScore"           AS "expertiseScore",
          m."categoryScore"            AS "categoryScore",
          m."geographicScore"          AS "geographicScore",
          m."capabilityScore"          AS "capabilityScore",
          m."activityScore"            AS "activityScore",
          m."finalScore"               AS "finalScore",
          m."rank"                     AS "matchRank",
          m."explanation"              AS "explanation",
          m."updatedAt"                AS "matchUpdatedAt"`
      : Prisma.empty;

    const supportedByViewer = Prisma.sql`EXISTS (
      SELECT 1 FROM problem_votes v
      WHERE v."problemId" = p."id" AND v."userId" = ${viewerId}::uuid
    )`;
    const followedByViewer = Prisma.sql`EXISTS (
      SELECT 1 FROM problem_follows f
      WHERE f."problemId" = p."id" AND f."userId" = ${viewerId}::uuid
    )`;
    const distance = context.origin
      ? Prisma.sql`ST_Distance(p."location", ${context.origin})`
      : Prisma.sql`NULL::double precision`;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<Row[]>(Prisma.sql`
        WITH ${context.expertise}
        SELECT
          p."publicId"                 AS "publicId",
          p."title"                    AS "title",
          p."category"::text           AS "category",
          p."subcategory"              AS "subcategory",
          p."status"::text             AS "status",
          p."severity"::text           AS "severity",
          p."urgency"::text            AS "urgency",
          p."address"                  AS "address",
          p."city"                     AS "city",
          p."voteCount"                AS "voteCount",
          p."commentCount"             AS "commentCount",
          p."createdAt"                AS "createdAt",
          p."reporterId"               AS "reporterId",
          (
            SELECT i."storageKey" FROM problem_images i
            WHERE i."problemId" = p."id" AND i."deletedAt" IS NULL
            ORDER BY i."isPrimary" DESC, i."sortOrder" ASC
            LIMIT 1
          )                            AS "thumbnailKey",
          ${supportedByViewer}         AS "supportedByViewer",
          ${followedByViewer}          AS "followedByViewer",
          ${distance}                  AS "distanceMeters",
          e.level                      AS "expertiseLevel",
          (
            e.subcategory IS NOT NULL AND p."subcategory" IS NOT NULL
            AND lower(e.subcategory) = lower(p."subcategory")
          )                            AS "subcategoryMatch",
          ${context.areaMatch}         AS "areaMatch",
          ai."processingStatus"::text  AS "aiStatus",
          ai."category"::text          AS "aiCategory",
          ai."subcategory"             AS "aiSubcategory",
          ai."severity"::text          AS "aiSeverity",
          ai."confidence"              AS "aiConfidence"
          ${matchColumns}
        FROM problems p
        ${matchJoin}
        LEFT JOIN expertise e ON e.category = p."category"::text
        LEFT JOIN LATERAL (
          SELECT a."processingStatus", a."category", a."subcategory", a."severity", a."confidence"
          FROM problem_ai_analyses a
          WHERE a."problemId" = p."id"
            AND a."analysisType" = 'INITIAL_ANALYSIS'
            AND a."processingStatus" = 'COMPLETED'
          ORDER BY a."createdAt" DESC
          LIMIT 1
        ) ai ON true
        WHERE ${where}
        ORDER BY ${
          match && filters.sort === 'relevance'
            ? Prisma.sql`m."finalScore" DESC, p."createdAt" DESC, p."publicId" ASC`
            : this.orderBy(context, filters.sort, distance)
        }
        LIMIT ${limit} OFFSET ${(page - 1) * limit}
      `),
      this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        WITH ${context.expertise}
        SELECT count(*)::int AS count
        FROM problems p
        ${matchJoin}
        LEFT JOIN expertise e ON e.category = p."category"::text
        WHERE ${where}
      `),
    ]);

    const totalCount = countRows[0]?.count ?? 0;

    return {
      rows,
      context,
      page: {
        page,
        limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
        origin: {
          kind: context.origin ? 'organization' : 'none',
          radiusMeters: filters.radiusMeters ?? null,
        },
      },
    };
  }

  /** How many problems match, without fetching any. */
  async count(
    organization: Organization,
    filters: Omit<WorkspaceProblemFilters, 'sort'>,
  ): Promise<number> {
    const context = await this.contextFor(organization);
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      WITH ${context.expertise}
      SELECT count(*)::int AS count
      FROM problems p
      LEFT JOIN expertise e ON e.category = p."category"::text
      WHERE ${this.conditions(context, { ...filters, sort: 'relevance' })}
    `);
    return rows[0]?.count ?? 0;
  }

  /** Opportunity counts per declared area of work. */
  async countByCategory(
    organization: Organization,
  ): Promise<Array<{ category: ProblemCategory; count: number }>> {
    const context = await this.contextFor(organization);
    return this.prisma.$queryRaw<Array<{ category: ProblemCategory; count: number }>>(
      Prisma.sql`
        WITH ${context.expertise}
        SELECT p."category"::text AS category, count(*)::int AS count
        FROM problems p
        LEFT JOIN expertise e ON e.category = p."category"::text
        WHERE ${this.conditions(context, { scope: 'relevant', sort: 'relevance' })}
        GROUP BY p."category"
        ORDER BY count DESC, category ASC
      `,
    );
  }

  /**
   * Resolves the organisation's expertise and location into SQL fragments.
   *
   * Expertise is a handful of rows, so it is read once and passed in as a
   * parameterised inline table — joining it is then an equality on the
   * category, with no per-row subquery.
   */
  private async contextFor(organization: Organization): Promise<QueryContext> {
    const expertise: OrganizationExpertise[] =
      await this.prisma.organizationExpertise.findMany({
        where: { organizationId: organization.id },
      });

    const expertiseCte = Prisma.sql`expertise AS (
      SELECT * FROM unnest(
        ${expertise.map((entry) => entry.category)}::text[],
        ${expertise.map((entry) => entry.level)}::text[],
        ${expertise.map((entry) => LEVEL_TIER[entry.level])}::int[],
        ${expertise.map((entry) => entry.subcategory)}::text[]
      ) AS e(category, level, tier, subcategory)
    )`;

    const hasCoordinates =
      organization.latitude !== null && organization.longitude !== null;

    const origin = hasCoordinates
      ? Prisma.sql`ST_SetSRID(ST_MakePoint(
          ${Number(organization.longitude)}::double precision,
          ${Number(organization.latitude)}::double precision
        ), 4326)::geography`
      : null;

    // The service area: a fixed radius around the registered location; failing
    // that, the registered city; failing both, everywhere — and the dashboard
    // says so, rather than silently showing nothing.
    const areaMatch = origin
      ? Prisma.sql`ST_DWithin(p."location", ${origin}, ${ORGANIZATION_SERVICE_RADIUS_METERS}::double precision)`
      : organization.city
        ? Prisma.sql`(p."city" IS NOT NULL AND lower(p."city") = lower(${organization.city}))`
        : Prisma.sql`true`;

    return { expertise: expertiseCte, origin, areaMatch, hasCoordinates };
  }

  private conditions(
    context: QueryContext,
    filters: WorkspaceProblemFilters,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [
      // The same visibility rule as every public feed: published, not a
      // confirmed duplicate, not removed.
      Prisma.sql`p."deletedAt" IS NULL`,
      Prisma.sql`p."status" <> 'DRAFT'`,
      Prisma.sql`p."duplicateOfId" IS NULL`,
    ];

    if (filters.status) {
      conditions.push(Prisma.sql`p."status" = ${filters.status}::"ProblemStatus"`);
    } else {
      conditions.push(
        Prisma.sql`p."status" = ANY (${[...ACTIVE_PROBLEM_STATUSES]}::"ProblemStatus"[])`,
      );
    }

    if (filters.scope === 'relevant') {
      // An opportunity is in an area of work *and* in the service area.
      conditions.push(Prisma.sql`e.category IS NOT NULL`);
      conditions.push(context.areaMatch);
    } else if (filters.serviceAreaOnly) {
      conditions.push(context.areaMatch);
    }

    if (filters.category) {
      conditions.push(Prisma.sql`p."category" = ${filters.category}::"ProblemCategory"`);
    }
    if (filters.severity) {
      conditions.push(Prisma.sql`p."severity" = ${filters.severity}::"ProblemSeverity"`);
    }
    if (filters.subcategory) {
      conditions.push(
        Prisma.sql`p."subcategory" ILIKE ${`%${escapeLike(filters.subcategory)}%`} ESCAPE '\\'`,
      );
    }
    if (filters.city) {
      conditions.push(Prisma.sql`lower(p."city") = lower(${filters.city})`);
    }
    if (filters.radiusMeters !== undefined && context.origin) {
      conditions.push(
        Prisma.sql`ST_DWithin(p."location", ${context.origin}, ${filters.radiusMeters}::double precision)`,
      );
    }
    if (filters.reportedWithinDays !== undefined) {
      // Compared against a cutoff computed in Node and bound as a parameter,
      // not `now()`. Timestamps are written through the same driver path, so
      // this stays consistent with them even while the database session time
      // zone is not UTC (see DATABASE.md, "timestamps and the session time
      // zone").
      const cutoff = new Date(Date.now() - filters.reportedWithinDays * 86_400_000);
      conditions.push(Prisma.sql`p."createdAt" >= ${cutoff}`);
    }

    return Prisma.join(conditions, ' AND ');
  }

  /**
   * The order. Every option ends in `publicId` so pages never overlap.
   *
   * "Relevance" is lexicographic, not a weighted score, so it can be stated
   * in a sentence: problems matching both your area of work and your service
   * area first, then by how strongly you declared that area, then most severe,
   * then newest.
   */
  private orderBy(
    context: QueryContext,
    sort: WorkspaceProblemSort,
    distance: Prisma.Sql,
  ): Prisma.Sql {
    const severity = Prisma.sql`CASE p."severity"
      WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END`;

    switch (sort) {
      case 'recent':
        return Prisma.sql`p."createdAt" DESC, p."publicId" ASC`;
      case 'severity':
        return Prisma.sql`${severity} DESC, p."createdAt" DESC, p."publicId" ASC`;
      case 'supported':
        return Prisma.sql`p."voteCount" DESC, p."createdAt" DESC, p."publicId" ASC`;
      case 'distance':
        return Prisma.sql`${distance} ASC, p."publicId" ASC`;
      default:
        return Prisma.sql`
          ((e.category IS NOT NULL)::int + (${context.areaMatch})::int) DESC,
          COALESCE(e.tier, 0) DESC,
          ${severity} DESC,
          p."createdAt" DESC,
          p."publicId" ASC`;
    }
  }

  /** An allow-list, as everywhere: the reporter id is read, never published. */
  private async toItem(
    row: Row,
    viewerId: string,
    hasCoordinates: boolean,
  ): Promise<OrganizationProblemItem> {
    const reasons: RelevanceReason[] = [];
    if (row.expertiseLevel) reasons.push('EXPERTISE_MATCH');
    if (row.subcategoryMatch) reasons.push('SUBCATEGORY_MATCH');
    if (row.areaMatch) reasons.push(hasCoordinates ? 'IN_SERVICE_AREA' : 'SAME_CITY');

    return {
      publicId: row.publicId,
      title: row.title,
      category: row.category,
      subcategory: row.subcategory,
      status: row.status,
      severity: row.severity,
      urgency: row.urgency,
      area: coarseArea(row.address, row.city),
      city: row.city,
      distanceMeters:
        row.distanceMeters === null ? null : Math.round(Number(row.distanceMeters)),
      voteCount: row.voteCount,
      commentCount: row.commentCount,
      thumbnailUrl: row.thumbnailKey ? await this.storage.getUrl(row.thumbnailKey) : null,
      createdAt: row.createdAt.toISOString(),
      hasAiAnalysis: row.aiStatus !== null,
      isOwnReport: row.reporterId === viewerId,
      supportedByCurrentUser: row.supportedByViewer,
      followedByCurrentUser: row.followedByViewer,
      relevance: { reasons, expertiseLevel: row.expertiseLevel },
      ai:
        row.aiStatus === null
          ? null
          : {
              category: row.aiCategory,
              subcategory: row.aiSubcategory,
              severity: row.aiSeverity,
              confidence: row.aiConfidence === null ? null : Number(row.aiConfidence),
            },
    };
  }
}

/** Escapes LIKE wildcards so a subcategory search matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
