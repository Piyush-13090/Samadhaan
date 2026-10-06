import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ACTIVE_PROBLEM_STATUSES, type ProblemCategory } from '@samadhaan/shared';
import { AiService } from '../ai/ai.service.js';
import type {
  AiMatchResult,
  MatchCandidateInput,
  MatchProblemInput,
} from '../ai/dto/matching.dto.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { buildCanonicalText } from '../problems/services/duplicate-detection.service.js';
import {
  findProblemEmbedding,
  storeProblemEmbedding,
  toVectorLiteral,
} from '../problems/services/problem-embedding.store.js';

/** One candidate as retrieval returns it. */
interface CandidateRow {
  id: string;
  type: 'NGO' | 'UNIVERSITY' | 'INDUSTRY';
  semantic: number | null;
  distance: number | null;
  hasLocation: boolean;
  sameCity: boolean;
}

/** Why a problem is being (re)matched — for logs only. */
export type MatchTrigger =
  'analysis' | 'organization-change' | 'recompute' | 'sweep' | 'status-change' | 'test';

/**
 * Organisation matching for problems (Prompt 14).
 *
 * The pipeline, per problem:
 *
 *   problem embedding (reused from duplicate detection, or created once)
 *     → candidate retrieval: pgvector top-K over organisation embeddings,
 *       ∪ organisations declaring the problem's category; eligibility
 *       (active, not suspended or rejected, NGO / university / industry) and
 *       PostGIS distance in the same statement
 *     → features + scoring in the AI service (the replaceable engine)
 *     → persisted matches, ranked, with every signal and the engine version
 *
 * Runs on a small in-process queue — the same detached-job model as analysis
 * and duplicate detection, without introducing a queue technology. Problem
 * creation never waits on it, and one problem is never matched twice at once.
 *
 * It only ever records **potential relevance**. Nothing here assigns,
 * allocates or notifies an organisation.
 */
@Injectable()
export class OrganizationMatchingService implements OnModuleDestroy {
  private readonly logger = new Logger(OrganizationMatchingService.name);

  private readonly pending = new Map<string, MatchTrigger>();
  private readonly running = new Set<string>();
  private readonly rerun = new Map<string, MatchTrigger>();
  private readonly waiters: Array<() => void> = [];
  private active = 0;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly config: AppConfig,
  ) {}

  onModuleDestroy(): void {
    this.stopped = true;
    this.pending.clear();
  }

  // --------------------------------------------------------------- queue

  /** Queues a problem. Returns at once; repeated calls coalesce. */
  enqueue(problemId: string, trigger: MatchTrigger): void {
    if (!this.config.matching.enabled || this.stopped) return;

    if (this.running.has(problemId)) {
      // Inputs changed mid-run: run once more afterwards, not concurrently.
      this.rerun.set(problemId, trigger);
      return;
    }
    if (!this.pending.has(problemId)) this.pending.set(problemId, trigger);
    setImmediate(() => this.pump());
  }

  /** Resolves when nothing is queued or running. For tests and the sweep. */
  idle(): Promise<void> {
    if (this.active === 0 && this.pending.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private pump(): void {
    while (!this.stopped && this.active < this.config.matching.concurrency) {
      const next = this.pending.entries().next();
      if (next.done) break;
      const [problemId, trigger] = next.value;
      this.pending.delete(problemId);
      this.running.add(problemId);
      this.active += 1;

      void this.run(problemId, trigger)
        .catch((error: unknown) => {
          this.logger.error(
            `Matching crashed for ${problemId}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        })
        .finally(() => {
          this.active -= 1;
          this.running.delete(problemId);
          const again = this.rerun.get(problemId);
          if (again) {
            this.rerun.delete(problemId);
            this.pending.set(problemId, again);
          }
          if (this.active === 0 && this.pending.size === 0) {
            for (const resolve of this.waiters.splice(0)) resolve();
          }
          this.pump();
        });
    }
  }

  // ----------------------------------------------------------------- run

  /** Matches one problem to completion. Public for tests; callers use `enqueue`. */
  async run(problemId: string, trigger: MatchTrigger): Promise<void> {
    const started = Date.now();
    const settings = this.config.matching;

    const problem = await this.prisma.problem.findFirst({
      where: { id: problemId, deletedAt: null },
    });
    if (!problem) return;

    // A problem that is no longer open civic work keeps no recommendations:
    // drafts were never published, duplicates point elsewhere, and closed
    // problems need nobody.
    const eligible =
      problem.duplicateOfId === null &&
      (ACTIVE_PROBLEM_STATUSES as readonly string[]).includes(problem.status);
    if (!eligible) {
      await this.prisma.organizationProblemMatch.deleteMany({
        where: { problemId, status: { not: 'DISMISSED' } },
      });
      return;
    }

    const job = await this.prisma.problemAiAnalysis.create({
      data: {
        problemId,
        modelName: 'pending',
        modelVersion: 'pending',
        analysisType: 'ORGANIZATION_MATCHING',
        processingStatus: 'PROCESSING',
      },
    });

    this.logger.log(`Matching started for ${problem.publicId} (${trigger})`);

    const analysis = await this.prisma.problemAiAnalysis.findFirst({
      where: {
        problemId,
        analysisType: { in: ['INITIAL_ANALYSIS', 'REANALYSIS'] },
        processingStatus: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
      select: { category: true, subcategory: true, summary: true },
    });

    // Reuse the embedding duplicate detection stored; create it only if absent.
    let embedding = await findProblemEmbedding(this.prisma, problemId);
    if (!embedding) {
      const outcome = await this.ai.embedText([buildCanonicalText(problem)]);
      const vector = outcome.ok ? outcome.embeddings.vectors[0] : undefined;
      if (outcome.ok && vector) {
        await storeProblemEmbedding(this.prisma, problemId, vector, outcome.embeddings);
        embedding = { vector, modelName: outcome.embeddings.modelName };
      } else {
        this.logger.warn(
          `Problem embedding failed for ${problem.publicId}; matching on expertise only`,
        );
      }
    }

    const categories = [problem.category, analysis?.category].filter(
      (value): value is ProblemCategory => Boolean(value),
    );
    const candidates = await this.retrieve(problemId, categories, embedding);

    this.logger.log(
      `Candidate retrieval for ${problem.publicId}: ${candidates.length} organisations`,
    );

    if (candidates.length === 0) {
      await this.persist(problemId, null, []);
      await this.finishJob(job.id, started, {
        status: 'COMPLETED',
        modelName: embedding?.modelName ?? 'none',
        modelVersion: 'no-candidates',
        result: { candidates: 0, matched: 0, trigger },
      });
      return;
    }

    const input = await this.buildInputs(problem, analysis, candidates);
    const outcome = await this.ai.matchOrganizations(input.problem, input.candidates, {
      resultLimit: settings.resultLimit,
      minScore: settings.minScore,
    });

    if (!outcome.ok) {
      this.logger.warn(
        `Matching failed for ${problem.publicId}: ${outcome.failure.code}`,
      );
      // Existing matches stay as they are — stale information is better than
      // none — and the next trigger tries again.
      await this.finishJob(job.id, started, {
        status: 'FAILED',
        modelName: embedding?.modelName ?? 'none',
        modelVersion: 'failed',
        error: outcome.failure.message,
        result: { candidates: candidates.length, trigger },
      });
      return;
    }

    const stored = await this.persist(problemId, outcome.result, input.candidates);

    await this.finishJob(job.id, started, {
      status: 'COMPLETED',
      modelName: outcome.result.embeddingModel ?? embedding?.modelName ?? 'none',
      modelVersion: outcome.result.matchingVersion,
      result: {
        trigger,
        candidates: candidates.length,
        matched: stored,
        degraded: outcome.result.degraded,
        engine: outcome.result.engine,
        engineVersion: outcome.result.engineVersion,
        trained: outcome.result.trained,
        weights: outcome.result.weights,
        aiProcessingMs: outcome.result.processingMs,
      },
    });

    this.logger.log(
      `Matching completed for ${problem.publicId}: ${stored} of ${candidates.length} ` +
        `(${outcome.result.matchingVersion}, ${Date.now() - started}ms)`,
    );
  }

  /**
   * Stage one: candidate retrieval, in one statement.
   *
   * The nearest organisation profiles by pgvector cosine distance (the HNSW
   * index serves the ORDER BY … LIMIT), unioned with organisations that
   * declare one of the problem's categories — so an organisation whose
   * embedding failed, or which describes itself sparsely, is never invisible
   * to a problem squarely in its field. Eligibility and PostGIS distance are
   * applied here too; Node receives at most `2 × candidateLimit` rows.
   */
  private async retrieve(
    problemId: string,
    categories: string[],
    embedding: { vector: number[]; modelName: string } | null,
  ): Promise<CandidateRow[]> {
    const limit = this.config.matching.candidateLimit;
    const eligible = Prisma.sql`
      o."deletedAt" IS NULL
      AND o."isActive"
      AND o.type IN ('NGO', 'UNIVERSITY', 'INDUSTRY')
      AND o."verificationStatus" NOT IN ('SUSPENDED', 'REJECTED')`;

    const vector = embedding ? toVectorLiteral(embedding.vector) : null;
    const byVector = vector
      ? Prisma.sql`
          SELECT e."organizationId" AS id
          FROM organization_embeddings e
          JOIN organizations o ON o.id = e."organizationId"
          WHERE e."modelName" = ${embedding!.modelName}
            AND e.embedding IS NOT NULL
            AND ${eligible}
          ORDER BY e.embedding <=> ${vector}::vector
          LIMIT ${limit}`
      : Prisma.sql`SELECT NULL::uuid AS id WHERE false`;

    const semantic = vector
      ? Prisma.sql`(
          SELECT 1 - (e.embedding <=> ${vector}::vector)
          FROM organization_embeddings e
          WHERE e."organizationId" = o.id AND e."modelName" = ${embedding!.modelName}
        )`
      : Prisma.sql`NULL::double precision`;

    return this.prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      WITH by_vector AS (${byVector}),
      by_category AS (
        SELECT DISTINCT x."organizationId" AS id
        FROM organization_expertise x
        JOIN organizations o ON o.id = x."organizationId"
        WHERE x.category::text = ANY (${categories}::text[]) AND ${eligible}
        LIMIT ${limit}
      ),
      ids AS (SELECT id FROM by_vector UNION SELECT id FROM by_category)
      SELECT
        o.id                                         AS id,
        o.type::text                                 AS type,
        ${semantic}                                  AS semantic,
        CASE WHEN o.location IS NOT NULL AND p.location IS NOT NULL
             THEN ST_Distance(o.location, p.location) END AS distance,
        (o.location IS NOT NULL)                     AS "hasLocation",
        (o.city IS NOT NULL AND p.city IS NOT NULL
          AND lower(o.city) = lower(p.city))         AS "sameCity"
      FROM ids
      JOIN organizations o ON o.id = ids.id
      CROSS JOIN problems p
      WHERE p.id = ${problemId}::uuid AND ${eligible}
    `);
  }

  /** Stage two's inputs: expertise and activity for every candidate, batched. */
  private async buildInputs(
    problem: {
      publicId: string;
      title: string;
      description: string;
      category: ProblemCategory;
      subcategory: string | null;
      severity: string;
      city: string | null;
      state: string | null;
    },
    analysis: {
      category: string | null;
      subcategory: string | null;
      summary: string | null;
    } | null,
    candidates: CandidateRow[],
  ): Promise<{ problem: MatchProblemInput; candidates: MatchCandidateInput[] }> {
    const ids = candidates.map((candidate) => candidate.id);

    const [expertise, activity] = await Promise.all([
      this.prisma.organizationExpertise.findMany({
        where: { organizationId: { in: ids } },
        select: { organizationId: true, category: true, subcategory: true, level: true },
        orderBy: [{ level: 'desc' }, { category: 'asc' }],
      }),
      // Suggestions on problems of the same category: the only history there
      // is yet. A weak, saturating signal — see the AI service's features.
      this.prisma.problemSuggestion.groupBy({
        by: ['organizationId'],
        where: {
          organizationId: { in: ids },
          deletedAt: null,
          problem: { category: problem.category },
        },
        _count: { _all: true },
      }),
    ]);

    const expertiseByOrg = new Map<string, MatchCandidateInput['expertise']>();
    for (const entry of expertise) {
      const list = expertiseByOrg.get(entry.organizationId) ?? [];
      list.push({
        category: entry.category,
        subcategory: entry.subcategory,
        level: entry.level,
      });
      expertiseByOrg.set(entry.organizationId, list);
    }
    const activityByOrg = new Map(
      activity.map((row) => [row.organizationId ?? '', row._count._all]),
    );

    return {
      problem: {
        publicId: problem.publicId,
        category: problem.category,
        aiCategory: analysis?.category ?? null,
        subcategory: problem.subcategory,
        aiSubcategory: analysis?.subcategory ?? null,
        severity: problem.severity,
        focusText: [buildCanonicalText(problem), analysis?.summary]
          .filter(Boolean)
          .join('\n'),
      },
      candidates: candidates.map((candidate) => ({
        organizationId: candidate.id,
        type: candidate.type,
        expertise: expertiseByOrg.get(candidate.id) ?? [],
        semanticSimilarity:
          candidate.semantic === null ? null : Number(candidate.semantic),
        distanceMeters: candidate.distance === null ? null : Number(candidate.distance),
        sameCity: candidate.sameCity,
        hasLocation: candidate.hasLocation,
        relevantActivityCount: activityByOrg.get(candidate.id) ?? 0,
      })),
    };
  }

  /**
   * Replaces the problem's matches with this run's, in one transaction.
   *
   * Every non-dismissed row is replaced — whatever its version — so an
   * organisation that no longer qualifies disappears and an older engine's
   * rows never linger beside newer ones. A dismissal is the organisation's
   * decision, not the engine's, and survives: the new row is written as
   * DISMISSED.
   */
  private async persist(
    problemId: string,
    result: AiMatchResult | null,
    candidates: MatchCandidateInput[],
  ): Promise<number> {
    const byId = new Map(
      candidates.map((candidate) => [candidate.organizationId, candidate]),
    );
    const matches = result?.matches ?? [];

    return this.prisma.$transaction(async (tx) => {
      const dismissed = new Set(
        (
          await tx.organizationProblemMatch.findMany({
            where: { problemId, status: 'DISMISSED' },
            select: { organizationId: true },
          })
        ).map((row) => row.organizationId),
      );

      await tx.organizationProblemMatch.deleteMany({
        where: { problemId, status: { not: 'DISMISSED' } },
      });
      if (matches.length === 0 || !result) return 0;

      // A re-dismissed organisation gets exactly one row: the new version's.
      await tx.organizationProblemMatch.deleteMany({
        where: {
          problemId,
          status: 'DISMISSED',
          organizationId: { in: matches.map((match) => match.organizationId) },
        },
      });

      await tx.organizationProblemMatch.createMany({
        data: matches.map((match) => {
          const candidate = byId.get(match.organizationId)!;
          return {
            problemId,
            organizationId: match.organizationId,
            semanticScore: match.signals.semantic,
            expertiseScore: match.signals.expertise,
            categoryScore: match.signals.category,
            geographicScore: match.signals.geographic,
            capabilityScore: match.signals.capability,
            activityScore: match.signals.activity,
            finalScore: match.finalScore,
            rank: match.rank,
            matchingVersion: result.matchingVersion,
            modelName: result.embeddingModel ?? 'none',
            modelVersion: result.engineVersion,
            status: dismissed.has(match.organizationId) ? 'DISMISSED' : 'CALCULATED',
            explanation: {
              reasons: match.reasons.map(({ code, value }) => ({ code, value })),
              matchedExpertise: match.matchedExpertise
                .map((index) => candidate.expertise[index])
                .filter(Boolean),
              distanceMeters:
                candidate.distanceMeters === null
                  ? null
                  : Math.round(candidate.distanceMeters),
            } satisfies Prisma.InputJsonObject,
          };
        }),
        skipDuplicates: true,
      });

      return matches.length;
    });
  }

  private async finishJob(
    jobId: string,
    started: number,
    outcome: {
      status: 'COMPLETED' | 'FAILED';
      modelName: string;
      modelVersion: string;
      error?: string;
      result: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    await this.prisma.problemAiAnalysis.update({
      where: { id: jobId },
      data: {
        processingStatus: outcome.status,
        modelName: outcome.modelName,
        modelVersion: outcome.modelVersion.slice(0, 120),
        processingMs: Date.now() - started,
        errorMessage: outcome.error ?? null,
        // Counts, versions and weights. No vectors and no organisation data.
        rawResult: outcome.result,
      },
    });
  }

  // ------------------------------------------------------------ freshness

  /**
   * An organisation changed: its current matches are stale, and the problems
   * it matched — plus the open problems nearest its new profile and in its
   * categories — are re-matched. Bounded; never "everything".
   */
  async organizationChanged(organizationId: string): Promise<number> {
    await this.prisma.organizationProblemMatch.updateMany({
      where: { organizationId, status: 'CALCULATED' },
      data: { status: 'STALE' },
    });

    const limit = this.config.matching.candidateLimit;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH matched AS (
        SELECT m."problemId" AS id FROM organization_problem_matches m
        WHERE m."organizationId" = ${organizationId}::uuid
      ),
      nearest AS (
        SELECT pe."problemId" AS id
        FROM organization_embeddings oe
        JOIN problem_embeddings pe
          ON pe."modelName" = oe."modelName" AND pe."embeddingType" = 'TEXT'
        WHERE oe."organizationId" = ${organizationId}::uuid
        ORDER BY pe.embedding <=> oe.embedding
        LIMIT ${limit}
      ),
      in_field AS (
        SELECT p.id FROM problems p
        JOIN organization_expertise x
          ON x.category = p.category AND x."organizationId" = ${organizationId}::uuid
        ORDER BY p."createdAt" DESC
        LIMIT ${limit}
      )
      SELECT DISTINCT p.id
      FROM (SELECT id FROM matched UNION SELECT id FROM nearest UNION SELECT id FROM in_field) ids
      JOIN problems p ON p.id = ids.id
      WHERE p."deletedAt" IS NULL
        AND p."duplicateOfId" IS NULL
        AND p.status = ANY (${[...ACTIVE_PROBLEM_STATUSES]}::"ProblemStatus"[])
      LIMIT ${limit * 3}
    `);

    for (const { id } of rows) this.enqueue(id, 'organization-change');
    return rows.length;
  }

  /**
   * Problems that need (re)matching: open problems with stale matches, or
   * with none and no matching attempt yet. Used by the startup sweep.
   */
  async problemsNeedingMatches(limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p.id FROM problems p
      WHERE p."deletedAt" IS NULL
        AND p."duplicateOfId" IS NULL
        AND p.status = ANY (${[...ACTIVE_PROBLEM_STATUSES]}::"ProblemStatus"[])
        AND (
          EXISTS (
            SELECT 1 FROM organization_problem_matches m
            WHERE m."problemId" = p.id AND m.status = 'STALE'
          )
          OR NOT EXISTS (
            SELECT 1 FROM problem_ai_analyses a
            WHERE a."problemId" = p.id AND a."analysisType" = 'ORGANIZATION_MATCHING'
          )
        )
      ORDER BY p."createdAt" DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => row.id);
  }
}
