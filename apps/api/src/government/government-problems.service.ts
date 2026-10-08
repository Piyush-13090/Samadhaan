import { Injectable, Logger } from '@nestjs/common';
import {
  NEARBY_RADIUS_METERS,
  REVIEW_NOTE_REQUIRED,
  REVIEW_QUEUE_STATUSES,
  allowedReviewTransitions,
  type AiStatusFilter,
  type DuplicateFilter,
  type GovernmentActivityEntry,
  type GovernmentAuditEntry,
  type GovernmentInternalNote,
  type GovernmentProblemDetail,
  type GovernmentProblemPage,
  type GovernmentQueueItem,
  type GovernmentSort,
  type GovernmentStatusFilter,
  type PriorityFilter,
  type PriorityReason,
  type PriorityTier,
  type ProblemCategory,
  type ProblemImageKind,
  type ProblemSeverity,
  type ProblemStatus,
  type ProblemUrgency,
  type ProcessingStatus,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import { Prisma } from '../generated/prisma/client.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { AppConfig } from '../config/app.config.js';
import { escapeLike } from '../organizations/workspace/organization-problems.service.js';
import { coarseArea } from '../problems/services/problem-discovery.service.js';
import { StorageService } from '../storage/storage.types.js';
import type { GovernmentScope } from './government-access.service.js';

export interface GovernmentProblemFilters {
  view: 'queue' | 'all';
  status?: GovernmentStatusFilter;
  severity?: ProblemSeverity;
  category?: ProblemCategory;
  subcategory?: string;
  city?: string;
  area?: string;
  reportedFrom?: Date;
  reportedTo?: Date;
  duplicate?: DuplicateFilter;
  aiStatus?: AiStatusFilter;
  q?: string;
  priority?: PriorityFilter;
  sort: GovernmentSort;
}

/** Audit actions the portal shows, and how. */
const ACTIVITY_ACTIONS = [
  'PROBLEM_STATUS_CHANGED',
  'PROBLEM_NOTE_ADDED',
  'PROBLEM_DUPLICATE_CONFIRMED',
  'ALLOCATION_CREATED',
  'ALLOCATION_ACCEPTED',
  'ALLOCATION_DECLINED',
  'ALLOCATION_CANCELLED',
  'PRIORITY_OVERRIDE_CREATED',
  'PRIORITY_OVERRIDE_UPDATED',
  'PRIORITY_OVERRIDE_REMOVED',
] as const;

const PRIORITY_KINDS = new Set([
  'PRIORITY_OVERRIDE_CREATED',
  'PRIORITY_OVERRIDE_UPDATED',
  'PRIORITY_OVERRIDE_REMOVED',
]);

/**
 * The effective priority tier of `p`: a government override when one exists,
 * else the latest AI tier. A correlated lookup on a unique index, so every
 * query that uses it stays self-contained.
 */
const EFFECTIVE_TIER = Prisma.sql`COALESCE(
  (SELECT o."priorityTier" FROM problem_priority_overrides o WHERE o."problemId" = p.id),
  p."priorityTier"
)`;
const TIER_RANK = Prisma.sql`CASE ${EFFECTIVE_TIER}
  WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END`;

const ALLOCATION_KINDS = new Set([
  'ALLOCATION_CREATED',
  'ALLOCATION_ACCEPTED',
  'ALLOCATION_DECLINED',
  'ALLOCATION_CANCELLED',
]);

interface QueueRow {
  id: string;
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
  followCount: number;
  createdAt: Date;
  thumbnailKey: string | null;
  aiStatus: ProcessingStatus | null;
  aiCategory: ProblemCategory | null;
  aiSubcategory: string | null;
  aiConfidence: Prisma.Decimal | string | null;
  possibleDuplicates: number;
  duplicateOfPublicId: string | null;
  priorityScore: Prisma.Decimal | string | null;
  aiTier: PriorityTier | null;
  effectiveTier: PriorityTier | null;
  assessedAt: Date | null;
}

interface AssessmentSummary {
  problemId: string;
  confidence: Prisma.Decimal;
  dataCompleteness: Prisma.Decimal;
  explanation: unknown;
}

interface AuditRow {
  id: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  metadata: unknown;
  createdAt: Date;
  problemPublicId: string;
  problemTitle: string;
  reporterId: string;
}

/**
 * Problems as a government office sees them: inside its jurisdiction only.
 *
 * Every query here includes `scope.jurisdiction.condition`. It is the
 * authorisation — a problem outside the area is answered exactly like a
 * problem that does not exist (404), so an official cannot probe another
 * office's area by guessing reference numbers.
 */
@Injectable()
export class GovernmentProblemsService {
  private readonly logger = new Logger(GovernmentProblemsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: DomainEventBus,
    private readonly allocations: AllocationsService,
    private readonly config: AppConfig,
  ) {}

  // ----------------------------------------------------------------- list

  async list(
    scope: GovernmentScope,
    filters: GovernmentProblemFilters,
    page: number,
    limit: number,
  ): Promise<GovernmentProblemPage> {
    const where = this.conditions(scope, filters);

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<QueueRow[]>(Prisma.sql`
        SELECT
          p.id                          AS "id",
          p."publicId"                  AS "publicId",
          p."title"                     AS "title",
          p."category"::text            AS "category",
          p."subcategory"               AS "subcategory",
          p."status"::text              AS "status",
          p."severity"::text            AS "severity",
          p."urgency"::text             AS "urgency",
          p."address"                   AS "address",
          p."city"                      AS "city",
          p."voteCount"                 AS "voteCount",
          p."commentCount"              AS "commentCount",
          p."followCount"               AS "followCount",
          p."createdAt"                 AS "createdAt",
          (
            SELECT i."storageKey" FROM problem_images i
            WHERE i."problemId" = p.id AND i."deletedAt" IS NULL
            ORDER BY i."isPrimary" DESC, i."sortOrder" ASC
            LIMIT 1
          )                             AS "thumbnailKey",
          ai."processingStatus"::text   AS "aiStatus",
          ai."category"::text           AS "aiCategory",
          ai."subcategory"              AS "aiSubcategory",
          ai."confidence"               AS "aiConfidence",
          (
            SELECT count(*)::int FROM problem_duplicate_candidates d
            WHERE d."problemId" = p.id AND d.status IN ('PENDING', 'LIKELY_DUPLICATE')
          )                             AS "possibleDuplicates",
          (
            SELECT o."publicId" FROM problems o WHERE o.id = p."duplicateOfId"
          )                             AS "duplicateOfPublicId",
          p."priorityScore"             AS "priorityScore",
          p."priorityTier"::text        AS "aiTier",
          ${EFFECTIVE_TIER}::text       AS "effectiveTier",
          p."priorityAssessedAt"        AS "assessedAt"
        FROM problems p
        ${this.latestAnalysisJoin()}
        WHERE ${where}
        ORDER BY ${this.orderBy(filters.sort)}
        LIMIT ${limit} OFFSET ${(page - 1) * limit}
      `),
      this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT count(*)::int AS count
        FROM problems p
        ${this.latestAnalysisJoin()}
        WHERE ${where}
      `),
    ]);

    const totalCount = countRows[0]?.count ?? 0;
    // The latest assessment of each problem on this page — one query, not N.
    const assessments = rows.length
      ? await this.prisma.$queryRaw<AssessmentSummary[]>(Prisma.sql`
          SELECT DISTINCT ON (a."problemId") a."problemId", a.confidence,
                 a."dataCompleteness", a.explanation
          FROM problem_priority_assessments a
          WHERE a."problemId" = ANY (${rows.map((r) => r.id)}::uuid[])
          ORDER BY a."problemId", a."calculatedAt" DESC
        `)
      : [];
    const byProblem = new Map(assessments.map((a) => [a.problemId, a]));
    return {
      items: await Promise.all(
        rows.map((row) => this.toQueueItem(row, byProblem.get(row.id) ?? null)),
      ),
      page,
      limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    };
  }

  /** The latest initial analysis, as `ai`. One indexed lookup per row. */
  private latestAnalysisJoin(): Prisma.Sql {
    return Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT a."processingStatus", a."category", a."subcategory", a."confidence"
        FROM problem_ai_analyses a
        WHERE a."problemId" = p.id AND a."analysisType" = 'INITIAL_ANALYSIS'
        ORDER BY a."createdAt" DESC
        LIMIT 1
      ) ai ON true`;
  }

  /** Visibility, jurisdiction, then filters. All bound parameters. */
  conditions(
    scope: GovernmentScope,
    filters: Partial<GovernmentProblemFilters>,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`p."deletedAt" IS NULL`,
      Prisma.sql`p."status" <> 'DRAFT'`,
      scope.jurisdiction.condition,
    ];

    if (filters.status) {
      conditions.push(Prisma.sql`p."status" = ${filters.status}::"ProblemStatus"`);
    } else if (filters.view !== 'all') {
      conditions.push(
        Prisma.sql`p."status" = ANY (${[...REVIEW_QUEUE_STATUSES]}::"ProblemStatus"[])`,
      );
    }
    if (filters.severity) {
      conditions.push(Prisma.sql`p."severity" = ${filters.severity}::"ProblemSeverity"`);
    }
    if (filters.priority === 'UNASSESSED') {
      conditions.push(Prisma.sql`${EFFECTIVE_TIER} IS NULL`);
    } else if (filters.priority) {
      conditions.push(
        Prisma.sql`${EFFECTIVE_TIER} = ${filters.priority}::"PriorityTier"`,
      );
    }
    if (filters.category) {
      conditions.push(Prisma.sql`p."category" = ${filters.category}::"ProblemCategory"`);
    }
    if (filters.subcategory) {
      conditions.push(
        Prisma.sql`p."subcategory" ILIKE ${`%${escapeLike(filters.subcategory)}%`} ESCAPE '\\'`,
      );
    }
    if (filters.city) {
      conditions.push(Prisma.sql`lower(p."city") = lower(${filters.city})`);
    }
    if (filters.area) {
      conditions.push(
        Prisma.sql`p."address" ILIKE ${`%${escapeLike(filters.area)}%`} ESCAPE '\\'`,
      );
    }
    // Bound as parameters computed in Node, consistent with how timestamps
    // are written (see DATABASE.md, "timestamps and the session time zone").
    if (filters.reportedFrom) {
      conditions.push(Prisma.sql`p."createdAt" >= ${filters.reportedFrom}`);
    }
    if (filters.reportedTo) {
      conditions.push(Prisma.sql`p."createdAt" < ${filters.reportedTo}`);
    }

    const openCandidates = Prisma.sql`EXISTS (
      SELECT 1 FROM problem_duplicate_candidates d
      WHERE d."problemId" = p.id AND d.status IN ('PENDING', 'LIKELY_DUPLICATE')
    )`;
    const confirmed = Prisma.sql`(p."duplicateOfId" IS NOT NULL OR p."status" = 'DUPLICATE')`;
    if (filters.duplicate === 'possible') conditions.push(openCandidates);
    if (filters.duplicate === 'confirmed') conditions.push(confirmed);
    if (filters.duplicate === 'none') {
      conditions.push(Prisma.sql`NOT ${openCandidates} AND NOT ${confirmed}`);
    }

    if (filters.aiStatus === 'completed') {
      conditions.push(Prisma.sql`ai."processingStatus" = 'COMPLETED'`);
    } else if (filters.aiStatus === 'pending') {
      conditions.push(Prisma.sql`ai."processingStatus" IN ('PENDING', 'PROCESSING')`);
    } else if (filters.aiStatus === 'failed') {
      conditions.push(Prisma.sql`ai."processingStatus" = 'FAILED'`);
    } else if (filters.aiStatus === 'none') {
      conditions.push(Prisma.sql`ai."processingStatus" IS NULL`);
    }

    if (filters.q) {
      // Basic search: the reference exactly, or words in the title,
      // description, address or category. Full-text and semantic search are a
      // later milestone. `title` has a trigram index; the rest is bounded by
      // the jurisdiction predicate first.
      const like = `%${escapeLike(filters.q)}%`;
      conditions.push(Prisma.sql`(
        upper(p."publicId") = upper(${filters.q})
        OR p."title" ILIKE ${like} ESCAPE '\\'
        OR p."description" ILIKE ${like} ESCAPE '\\'
        OR p."address" ILIKE ${like} ESCAPE '\\'
        OR replace(p."category"::text, '_', ' ') ILIKE ${like} ESCAPE '\\'
      )`);
    }

    return Prisma.join(conditions, ' AND ');
  }

  private orderBy(sort: GovernmentSort): Prisma.Sql {
    const severity = Prisma.sql`CASE p."severity"
      WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END`;
    switch (sort) {
      case 'newest':
        return Prisma.sql`p."createdAt" DESC, p."publicId" ASC`;
      case 'oldest':
        return Prisma.sql`p."createdAt" ASC, p."publicId" ASC`;
      case 'severity':
        return Prisma.sql`${severity} DESC, p."createdAt" DESC, p."publicId" ASC`;
      case 'supported':
        return Prisma.sql`p."voteCount" DESC, p."createdAt" DESC, p."publicId" ASC`;
      case 'urgency':
        return Prisma.sql`CASE p."urgency"
          WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END DESC,
          p."createdAt" ASC, p."publicId" ASC`;
      case 'priority':
        // Effective tier (an override wins), then the AI score, then the one
        // that has waited longest. Unassessed problems follow, never hidden.
        return Prisma.sql`${TIER_RANK} DESC, p."priorityScore" DESC, p."createdAt" ASC, p."publicId" ASC`;
      default:
        // The review queue: most severe first, and within a band the one that
        // has waited longest.
        return Prisma.sql`${severity} DESC, p."createdAt" ASC, p."publicId" ASC`;
    }
  }

  private async toQueueItem(
    row: QueueRow,
    assessment: AssessmentSummary | null,
  ): Promise<GovernmentQueueItem> {
    const confidence = assessment ? Number(assessment.confidence) : null;
    const completeness = assessment ? Number(assessment.dataCompleteness) : null;
    const reasons = (
      Array.isArray(assessment?.explanation) ? assessment.explanation : []
    ) as PriorityReason[];
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
      distanceMeters: null,
      voteCount: row.voteCount,
      commentCount: row.commentCount,
      followCount: row.followCount,
      thumbnailUrl: row.thumbnailKey ? await this.storage.getUrl(row.thumbnailKey) : null,
      createdAt: row.createdAt.toISOString(),
      hasAiAnalysis: row.aiStatus === 'COMPLETED',
      ai: {
        status: row.aiStatus,
        category: row.aiCategory,
        subcategory: row.aiSubcategory,
        confidence: row.aiConfidence === null ? null : Number(row.aiConfidence),
      },
      duplicates: {
        possible: row.possibleDuplicates,
        confirmedOf: row.duplicateOfPublicId,
      },
      priority: {
        tier: row.effectiveTier,
        aiTier: row.aiTier,
        score: row.assessedAt ? Number(row.priorityScore) : null,
        overridden: row.effectiveTier !== null && row.effectiveTier !== row.aiTier,
        confidence,
        dataCompleteness: completeness,
        provisional:
          confidence !== null &&
          completeness !== null &&
          (confidence < this.config.priority.provisional.confidence ||
            completeness < this.config.priority.provisional.completeness),
        summary: reasons
          .filter((r) => r.kind === 'driver')
          .slice(0, 2)
          .map((r) => r.text),
      },
    };
  }

  // --------------------------------------------------------------- detail

  /** The problem's id, only if it is inside this jurisdiction. */
  async findInScope(
    scope: GovernmentScope,
    publicId: string,
  ): Promise<{
    id: string;
    status: ProblemStatus;
    reporterId: string;
    publicId: string;
  }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; status: ProblemStatus; reporterId: string; publicId: string }>
    >(Prisma.sql`
      SELECT p.id, p.status::text AS status, p."reporterId", p."publicId"
      FROM problems p
      WHERE upper(p."publicId") = upper(${publicId})
        AND p."deletedAt" IS NULL
        AND p."status" <> 'DRAFT'
        AND ${scope.jurisdiction.condition}
    `);
    const problem = rows[0];
    // Outside the jurisdiction and non-existent are the same answer.
    if (!problem) throw AppException.notFound('Problem');
    return problem;
  }

  async detail(
    scope: GovernmentScope,
    publicId: string,
  ): Promise<GovernmentProblemDetail> {
    const { id } = await this.findInScope(scope, publicId);

    const [problem, analysis, candidates, nearby, notes, audit] = await Promise.all([
      this.prisma.problem.findUniqueOrThrow({
        where: { id },
        include: {
          images: {
            where: { deletedAt: null },
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
          },
          duplicateOf: { select: { publicId: true, title: true } },
        },
      }),
      this.prisma.problemAiAnalysis.findFirst({
        where: { problemId: id, analysisType: 'INITIAL_ANALYSIS' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.$queryRaw<
        Array<{
          publicId: string;
          title: string;
          status: ProblemStatus;
          verdict: 'PENDING' | 'LIKELY_DUPLICATE';
          combined: Prisma.Decimal | null;
          text: Prisma.Decimal | null;
          geographic: Prisma.Decimal | null;
          category: Prisma.Decimal | null;
          image: Prisma.Decimal | null;
          distance: number | null;
        }>
      >(Prisma.sql`
        SELECT c."publicId", c.title, c.status::text AS status, d.status::text AS verdict,
               d."combinedScore" AS combined, d."textSimilarity" AS text,
               d."geographicSimilarity" AS geographic, d."categorySimilarity" AS category,
               d."imageSimilarity" AS image,
               ST_Distance(p.location, c.location) AS distance
        FROM problem_duplicate_candidates d
        JOIN problems p ON p.id = d."problemId"
        JOIN problems c ON c.id = d."candidateProblemId"
        WHERE d."problemId" = ${id}::uuid
          AND d.status IN ('PENDING', 'LIKELY_DUPLICATE')
          AND c."deletedAt" IS NULL
        ORDER BY d."combinedScore" DESC NULLS LAST
        LIMIT 5
      `),
      this.nearby(scope, id),
      this.notes(scope, id),
      this.audit(scope, { problemId: id, limit: 50 }),
    ]);

    const raw = (analysis?.rawResult ?? {}) as {
      observations?: unknown;
      textOnly?: unknown;
    };
    const num = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

    return {
      problem: {
        publicId: problem.publicId,
        title: problem.title,
        description: problem.description,
        category: problem.category,
        subcategory: problem.subcategory,
        status: problem.status,
        severity: problem.severity,
        urgency: problem.urgency,
        createdAt: problem.createdAt.toISOString(),
        updatedAt: problem.updatedAt.toISOString(),
        location: {
          address: problem.address,
          city: problem.city,
          state: problem.state,
          postalCode: problem.postalCode,
          latitude: Number(problem.latitude),
          longitude: Number(problem.longitude),
        },
        images: await Promise.all(
          problem.images.map(async (image) => ({
            url: await this.storage.getUrl(image.storageKey),
            kind: image.kind as ProblemImageKind,
          })),
        ),
      },
      analysis: analysis
        ? {
            status: analysis.processingStatus,
            modelName: analysis.modelName,
            modelVersion: analysis.modelVersion,
            analysedAt: analysis.updatedAt.toISOString(),
            processingMs: analysis.processingMs,
            category: analysis.category,
            subcategory: analysis.subcategory,
            severity: analysis.severity,
            urgency: analysis.urgency,
            severityScore: num(analysis.severityScore),
            confidence: num(analysis.confidence),
            summary: analysis.summary,
            // Evidence statements written for people — never the prompt or
            // any model reasoning, which are not stored.
            observations: Array.isArray(raw.observations)
              ? raw.observations.filter(
                  (entry): entry is string => typeof entry === 'string',
                )
              : [],
            textOnly: raw.textOnly === true,
          }
        : null,
      duplicates: {
        confirmedOf: problem.duplicateOf,
        possible: candidates.map((candidate) => ({
          publicId: candidate.publicId,
          title: candidate.title,
          status: candidate.status,
          similarity: num(candidate.combined),
          verdict: candidate.verdict,
          signals: {
            text: num(candidate.text),
            geographic: num(candidate.geographic),
            category: num(candidate.category),
            image: num(candidate.image),
          },
          distanceMeters:
            candidate.distance === null ? null : Math.round(Number(candidate.distance)),
        })),
      },
      community: {
        supporters: problem.voteCount,
        followers: problem.followCount,
        comments: problem.commentCount,
        lastCommentAt: problem.lastCommentAt?.toISOString() ?? null,
      },
      nearby,
      allowedTransitions: allowedReviewTransitions(problem.status),
      allocation: await this.allocations.governmentPanel(scope, {
        id: problem.id,
        status: problem.status,
      }),
      notes,
      audit: audit as GovernmentAuditEntry[],
    };
  }

  /** Other problems within a kilometre — inside the same jurisdiction. */
  private async nearby(
    scope: GovernmentScope,
    problemId: string,
  ): Promise<GovernmentProblemDetail['nearby']> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        publicId: string;
        title: string;
        category: ProblemCategory;
        severity: ProblemSeverity;
        status: ProblemStatus;
        distance: number;
        sameCategory: boolean;
        total: number;
      }>
    >(Prisma.sql`
      SELECT p."publicId", p.title, p.category::text AS category, p.severity::text AS severity,
             p.status::text AS status, ST_Distance(p.location, t.location) AS distance,
             p.category = t.category AS "sameCategory",
             count(*) OVER ()::int AS total
      FROM problems p
      JOIN problems t ON t.id = ${problemId}::uuid
      WHERE p.id <> t.id
        AND p."deletedAt" IS NULL
        AND p."status" <> 'DRAFT'
        AND ST_DWithin(p.location, t.location, ${NEARBY_RADIUS_METERS}::double precision)
        AND ${scope.jurisdiction.condition}
      ORDER BY distance ASC
      LIMIT 50
    `);

    return {
      radiusMeters: NEARBY_RADIUS_METERS,
      total: rows[0]?.total ?? 0,
      sameCategory: rows.filter((row) => row.sameCategory).length,
      items: rows.slice(0, 5).map((row) => ({
        publicId: row.publicId,
        title: row.title,
        category: row.category,
        severity: row.severity,
        status: row.status,
        distanceMeters: Math.round(Number(row.distance)),
      })),
    };
  }

  // ---------------------------------------------------------------- notes

  /** This office's notes on a problem. Never another office's. */
  async notes(
    scope: GovernmentScope,
    problemId: string,
  ): Promise<GovernmentInternalNote[]> {
    const notes = await this.prisma.problemInternalNote.findMany({
      where: { problemId, organizationId: scope.organization.id, visibility: 'INTERNAL' },
      include: { author: { select: { fullName: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return notes.map((note) => ({
      id: note.id,
      body: note.body,
      visibility: 'INTERNAL',
      author: { name: note.author.fullName },
      createdAt: note.createdAt.toISOString(),
    }));
  }

  async addNote(
    scope: GovernmentScope,
    publicId: string,
    body: string,
    user: RequestUser,
  ): Promise<GovernmentInternalNote> {
    const { id } = await this.findInScope(scope, publicId);

    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.problemInternalNote.create({
        data: {
          problemId: id,
          organizationId: scope.organization.id,
          authorId: user.id,
          body,
          visibility: 'INTERNAL',
        },
        include: { author: { select: { fullName: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'PROBLEM_NOTE_ADDED',
          entityType: 'Problem',
          entityId: id,
          // The note's id, not its text: the audit trail must not become a
          // second, less-guarded copy of internal notes.
          metadata: { noteId: created.id, organizationId: scope.organization.id },
        },
      });
      return created;
    });

    return {
      id: note.id,
      body: note.body,
      visibility: 'INTERNAL',
      author: { name: note.author.fullName },
      createdAt: note.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------- transitions

  /**
   * Moves a problem along the review path — and nowhere else.
   *
   * The checks, in order: the problem is inside the jurisdiction (404
   * otherwise); the transition is one this milestone allows from the
   * problem's *current* status (409); a rejection carries a reason (400). The
   * update is conditional on the status the decision was made against, so two
   * reviewers acting at once cannot both succeed; the loser gets 409.
   *
   * The audit entry is written in the same transaction, and the existing
   * PROBLEM_STATUS_CHANGED event notifies the reporter and followers.
   */
  async transition(
    scope: GovernmentScope,
    publicId: string,
    to: ProblemStatus,
    note: string | null,
    user: RequestUser,
  ): Promise<{ status: ProblemStatus; allowedTransitions: ProblemStatus[] }> {
    const problem = await this.findInScope(scope, publicId);
    const from = problem.status;

    if (!allowedReviewTransitions(from).includes(to)) {
      throw AppException.conflict(
        `A problem that is ${from.replace('_', ' ').toLowerCase()} cannot be moved to ${to
          .replace('_', ' ')
          .toLowerCase()} from the review queue.`,
      );
    }
    if (REVIEW_NOTE_REQUIRED.includes(to) && !note) {
      throw AppException.badRequest('Give a reason when rejecting a report.');
    }

    const changeId = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.problem.updateMany({
        where: { id: problem.id, status: from },
        data: { status: to },
      });
      if (count === 0) {
        throw AppException.conflict(
          'Someone else changed this problem while you were reviewing it. Reload and try again.',
        );
      }

      const audit = await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'PROBLEM_STATUS_CHANGED',
          entityType: 'Problem',
          entityId: problem.id,
          metadata: {
            from,
            to,
            note,
            organizationId: scope.organization.id,
            organizationName: scope.organization.name,
          },
        },
      });
      return audit.id;
    });

    this.events.publish({
      type: 'PROBLEM_STATUS_CHANGED',
      problemId: problem.id,
      problemPublicId: problem.publicId,
      reporterId: problem.reporterId,
      fromStatus: from,
      toStatus: to,
      actorUserId: user.id,
      changeId,
      reviewedBy: scope.organization.name,
    });

    this.logger.log(
      `${problem.publicId}: ${from} → ${to} by ${scope.organization.slug} (${changeId})`,
    );

    return { status: to, allowedTransitions: allowedReviewTransitions(to) };
  }

  // ---------------------------------------------------------------- audit

  /**
   * Audit entries for problems in the jurisdiction — one problem, or the
   * most recent across the whole area. Read-only: there is no endpoint, here
   * or anywhere, that edits an audit entry, and the database refuses it.
   */
  async audit(
    scope: GovernmentScope,
    options: { problemId?: string; limit: number },
  ): Promise<GovernmentAuditEntry[]> {
    const [rows, members] = await Promise.all([
      this.prisma.$queryRaw<AuditRow[]>(Prisma.sql`
        SELECT a.id, a.action, a."actorUserId", u."fullName" AS "actorName",
               a.metadata, a."createdAt",
               p."publicId" AS "problemPublicId", p.title AS "problemTitle",
               p."reporterId" AS "reporterId"
        FROM audit_logs a
        JOIN problems p ON p.id = a."entityId"
        LEFT JOIN users u ON u.id = a."actorUserId"
        WHERE a."entityType" = 'Problem'
          AND a.action = ANY (${[...ACTIVITY_ACTIONS]}::text[])
          AND p."deletedAt" IS NULL
          AND ${scope.jurisdiction.condition}
          ${options.problemId ? Prisma.sql`AND p.id = ${options.problemId}::uuid` : Prisma.empty}
        ORDER BY a."createdAt" DESC, a.id DESC
        LIMIT ${options.limit}
      `),
      this.prisma.organizationMember.findMany({
        where: { organizationId: scope.organization.id, status: 'ACTIVE' },
        select: { userId: true },
      }),
    ]);

    const team = new Set(members.map((member) => member.userId));
    return rows.map((row) => this.toAuditEntry(row, scope, team));
  }

  private toAuditEntry(
    row: AuditRow,
    scope: GovernmentScope,
    team: ReadonlySet<string>,
  ): GovernmentAuditEntry {
    const meta =
      typeof row.metadata === 'object' && row.metadata !== null
        ? (row.metadata as Record<string, unknown>)
        : {};
    const ours = meta.organizationId === scope.organization.id;

    const kind: GovernmentActivityEntry['kind'] =
      ALLOCATION_KINDS.has(row.action) || PRIORITY_KINDS.has(row.action)
        ? (row.action as GovernmentActivityEntry['kind'])
        : row.action === 'PROBLEM_NOTE_ADDED'
          ? 'NOTE_ADDED'
          : row.action === 'PROBLEM_DUPLICATE_CONFIRMED'
            ? 'DUPLICATE_CONFIRMED'
            : 'STATUS_CHANGED';
    const organizationName =
      typeof meta.organizationName === 'string' ? meta.organizationName : null;
    // An organisation's response is attributed to the organisation by name —
    // a public fact — never to the individual member.
    const respondedByOrganization =
      typeof meta.respondingOrganizationName === 'string' ||
      (kind === 'STATUS_CHANGED' && meta.viaAllocation === true);

    // Named only when the actor is on this office's team. A citizen (the
    // reporter confirming a duplicate) or another office is described, not
    // identified.
    const actor: GovernmentActivityEntry['actor'] =
      row.actorUserId === null
        ? { name: null, kind: 'SYSTEM' }
        : respondedByOrganization
          ? { name: organizationName, kind: 'ORGANIZATION' }
          : team.has(row.actorUserId)
            ? { name: row.actorName, kind: 'TEAM' }
            : row.actorUserId === row.reporterId
              ? { name: null, kind: 'CITIZEN' }
              : { name: null, kind: 'OTHER' };

    const status = (value: unknown) =>
      typeof value === 'string' ? (value as ProblemStatus) : null;
    const tier = (value: unknown) =>
      typeof value === 'string' ? (value as PriorityTier) : null;

    return {
      id: row.id,
      kind,
      problemPublicId: row.problemPublicId,
      problemTitle: row.problemTitle,
      organizationName,
      fromStatus: kind === 'STATUS_CHANGED' ? status(meta.from) : null,
      toStatus:
        kind === 'STATUS_CHANGED'
          ? status(meta.to)
          : kind === 'DUPLICATE_CONFIRMED'
            ? 'DUPLICATE'
            : null,
      ...(PRIORITY_KINDS.has(row.action)
        ? { fromPriority: tier(meta.fromTier), toPriority: tier(meta.toTier) }
        : {}),
      actor,
      // A review note belongs to the office that wrote it.
      note: ours && typeof meta.note === 'string' ? meta.note : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
