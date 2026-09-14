import { Injectable, Logger } from '@nestjs/common';
import {
  EMBEDDING_DIMENSIONS,
  type DuplicateCheckView,
  type ProblemCategory,
} from '@samadhaan/shared';
import { AiService } from '../../ai/ai.service.js';
import { AppException } from '../../common/app.exception.js';
import { AppConfig, type DuplicateDetectionConfig } from '../../config/app.config.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { ProblemStatus } from '../../generated/prisma/enums.js';
import { toSimilarProblemView } from '../duplicate.serializer.js';
import { DuplicateScoringService } from './duplicate-scoring.service.js';

/**
 * Statuses a candidate must not have to be worth matching against.
 *
 * `DRAFT` was never published. `REJECTED` was judged not to be a real problem.
 * `DUPLICATE` was already merged into something else — matching it would build
 * chains of duplicates-of-duplicates instead of pointing at the canonical
 * report. `ARCHIVED` is deliberately *not* excluded: an archived pothole that
 * resurfaces is exactly the case worth surfacing.
 */
const INELIGIBLE_CANDIDATE_STATUSES: readonly ProblemStatus[] = [
  'DRAFT',
  'REJECTED',
  'DUPLICATE',
];

/** One row from the candidate-retrieval query. */
interface CandidateRow {
  id: string;
  publicId: string;
  title: string;
  category: ProblemCategory;
  subcategory: string | null;
  status: ProblemStatus;
  city: string | null;
  createdAt: Date;
  voteCount: number;
  textSimilarity: number;
  distanceMeters: number | null;
}

/**
 * Finds problems that may already describe the same real-world issue.
 *
 * **The pipeline is deliberately cheap-to-expensive.** A vector search bounded
 * by a PostGIS radius returns at most a few dozen candidates; only those are
 * scored. Nothing loads the corpus into Node, and nothing compares every pair —
 * both would work at seed-data scale and fall over at the scale this is for.
 *
 *   canonical text -> embedding -> pgvector + PostGIS retrieval (SQL, bounded)
 *                  -> signal scoring -> threshold -> persist -> UI
 *
 * **Nothing here merges anything.** The highest score this can produce is
 * `LIKELY_DUPLICATE`, which is a prompt for a person. Confirmation is a human
 * action, in `confirm()` below.
 */
@Injectable()
export class DuplicateDetectionService {
  private readonly logger = new Logger(DuplicateDetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly scoring: DuplicateScoringService,
    private readonly config: AppConfig,
  ) {}

  private get settings(): DuplicateDetectionConfig {
    return this.config.duplicateDetection;
  }

  /**
   * Queues a duplicate check and returns immediately.
   *
   * Same shape as problem analysis, and for the same reason: a citizen must not
   * wait on an embedding model and a vector scan to see their report confirmed.
   *
   * The job's state *is* its `ProblemAiAnalysis` row with
   * `analysisType = DUPLICATE_ANALYSIS`. No dedicated `duplicateCheckStatus`
   * column was added: this is an AI job with a lifecycle, that table already
   * models exactly that, and the startup sweep that reclaims interrupted
   * analyses covers duplicate checks for free.
   */
  async enqueue(problemId: string, requestId?: string): Promise<void> {
    const job = await this.prisma.problemAiAnalysis.create({
      data: {
        problemId,
        modelName: 'pending',
        modelVersion: 'pending',
        analysisType: 'DUPLICATE_ANALYSIS',
        processingStatus: 'PENDING',
      },
    });

    // Detached on purpose: the caller is answering a citizen's HTTP request.
    void this.run(job.id, problemId, requestId).catch((error: unknown) => {
      this.logger.error(
        `Duplicate check ${job.id} crashed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    });
  }

  /** Re-runs the check. Refuses while one is already in flight. */
  async retry(problemId: string, requestId?: string): Promise<void> {
    const inFlight = await this.prisma.problemAiAnalysis.findFirst({
      where: {
        problemId,
        analysisType: 'DUPLICATE_ANALYSIS',
        processingStatus: { in: ['PENDING', 'PROCESSING'] },
      },
    });

    if (inFlight) {
      throw AppException.conflict('A duplicate check is already running for this problem.');
    }

    await this.enqueue(problemId, requestId);
  }

  /** Runs one duplicate check to completion. */
  private async run(jobId: string, problemId: string, requestId?: string): Promise<void> {
    const started = Date.now();

    const problem = await this.prisma.problem.findFirst({
      where: { id: problemId, deletedAt: null },
    });

    if (!problem) {
      await this.markFailed(jobId, 'The problem no longer exists.');
      return;
    }

    await this.updateJob(jobId, { processingStatus: 'PROCESSING' });

    this.logger.log(`Duplicate check started for ${problem.publicId}`);

    const outcome = await this.ai.embedText([buildCanonicalText(problem)], requestId);

    if (!outcome.ok) {
      this.logger.warn(
        `Duplicate check failed for ${problem.publicId}: ${outcome.failure.code}`,
      );
      await this.markFailed(jobId, outcome.failure.message);
      return;
    }

    const { embeddings } = outcome;
    const vector = embeddings.vectors[0];

    if (!vector) {
      await this.markFailed(jobId, 'The problem could not be encoded.');
      return;
    }

    await this.storeEmbedding(problemId, vector, embeddings);

    const candidates = await this.findCandidates(problem, vector, embeddings.modelName);
    const scored = this.scoreCandidates(problem, candidates);
    const kept = await this.persistCandidates(problemId, scored);

    const durationMs = Date.now() - started;

    await this.updateJob(jobId, {
      modelName: embeddings.modelName,
      modelVersion: embeddings.modelVersion,
      processingStatus: 'COMPLETED',
      processingMs: durationMs,
      errorMessage: null,
      // Provenance and counts only. No vectors: they are reconstructable
      // representations of the source text and have no business in a column
      // that anything might later serialise.
      rawResult: {
        provider: embeddings.provider,
        comparedCount: candidates.length,
        keptCount: kept,
        likelyCount: scored.filter((entry) => entry.verdict === 'LIKELY_DUPLICATE').length,
      },
    });

    this.logger.log(
      `Duplicate check completed for ${problem.publicId} ` +
        `(${candidates.length} compared, ${kept} stored, ` +
        `${scored.filter((e) => e.verdict === 'LIKELY_DUPLICATE').length} likely, ` +
        `${embeddings.modelName}, ${durationMs}ms)`,
    );
  }

  /**
   * Writes the problem's text embedding.
   *
   * Raw SQL because Prisma cannot express `vector`. The cast is explicit and
   * the vector is parameterised as a string — never interpolated — so the
   * usual raw-SQL hazard does not apply.
   *
   * Upsert on `(problemId, embeddingType, modelName)`: re-embedding with the
   * *same* model replaces the row, while a different model writes a new one.
   * That is what keeps a model change from silently overwriting the corpus it
   * can no longer be compared with.
   */
  private async storeEmbedding(
    problemId: string,
    vector: number[],
    meta: { modelName: string; modelVersion: string; dimensions: number },
  ): Promise<void> {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Refusing to store a ${vector.length}-dimensional vector; ` +
          `the column is ${EMBEDDING_DIMENSIONS}.`,
      );
    }

    const literal = `[${vector.join(',')}]`;

    // Columns are camelCase and therefore case-sensitive in PostgreSQL: Prisma
    // maps table names via `@@map` but leaves field names as written, so every
    // identifier here must stay quoted.
    await this.prisma.$executeRaw`
      INSERT INTO problem_embeddings
        ("id", "problemId", "embeddingType", "modelName", "modelVersion",
         "dimensions", "embedding", "createdAt")
      VALUES
        (gen_random_uuid(), ${problemId}::uuid, 'TEXT'::"EmbeddingType",
         ${meta.modelName}, ${meta.modelVersion}, ${meta.dimensions},
         ${literal}::vector, now())
      ON CONFLICT ("problemId", "embeddingType", "modelName")
      DO UPDATE SET
        "embedding" = EXCLUDED."embedding",
        "modelVersion" = EXCLUDED."modelVersion",
        "dimensions" = EXCLUDED."dimensions",
        "createdAt" = now()
    `;
  }

  /**
   * Retrieves scoring candidates in one query.
   *
   * Everything that can be decided in the database is decided there: vector
   * proximity, geographic proximity, eligibility, direction and the limit. The
   * alternative — fetch embeddings, compare in Node — is the thing this method
   * exists to avoid.
   *
   * `1 - (embedding <=> $vector)` converts pgvector's cosine *distance* into
   * the cosine *similarity* the scorer expects. Ordering by the raw operator
   * keeps the HNSW index usable.
   *
   * Two filters encode rules that are easy to miss:
   *
   *  - `model_name = $model` — vectors from different encoders are not
   *    comparable, and a cosine between them is a meaningless number that looks
   *    exactly like a meaningful one.
   *  - `created_at <= target.created_at` — the newer report is always the one
   *    being checked, because merging is directional and the older report is
   *    canonical.
   */
  private async findCandidates(
    problem: { id: string; createdAt: Date },
    vector: number[],
    modelName: string,
  ): Promise<CandidateRow[]> {
    const { candidateLimit, maxDistanceMeters, minTextSimilarity } = this.settings;
    const literal = `[${vector.join(',')}]`;

    return this.prisma.$queryRaw<CandidateRow[]>`
      SELECT
        candidate."id"                                        AS "id",
        candidate."publicId"                                  AS "publicId",
        candidate."title"                                     AS "title",
        candidate."category"::text                            AS "category",
        candidate."subcategory"                               AS "subcategory",
        candidate."status"::text                              AS "status",
        candidate."city"                                      AS "city",
        candidate."createdAt"                                 AS "createdAt",
        candidate."voteCount"                                 AS "voteCount",
        1 - (embedding."embedding" <=> ${literal}::vector)    AS "textSimilarity",
        ST_Distance(candidate."location", target."location")  AS "distanceMeters"
      FROM problem_embeddings AS embedding
      JOIN problems AS candidate ON candidate."id" = embedding."problemId"
      CROSS JOIN (
        SELECT "location", "createdAt" FROM problems WHERE "id" = ${problem.id}::uuid
      ) AS target
      WHERE embedding."embeddingType" = 'TEXT'::"EmbeddingType"
        AND embedding."modelName" = ${modelName}
        AND embedding."embedding" IS NOT NULL
        AND candidate."id" <> ${problem.id}::uuid
        AND candidate."deletedAt" IS NULL
        AND candidate."duplicateOfId" IS NULL
        AND candidate."status" <> ALL (${INELIGIBLE_CANDIDATE_STATUSES}::"ProblemStatus"[])
        AND candidate."createdAt" <= target."createdAt"
        AND ST_DWithin(candidate."location", target."location", ${maxDistanceMeters})
        AND 1 - (embedding."embedding" <=> ${literal}::vector) >= ${minTextSimilarity}
      ORDER BY embedding."embedding" <=> ${literal}::vector
      LIMIT ${candidateLimit}
    `;
  }

  /** Scores every retrieved candidate and keeps those worth showing. */
  private scoreCandidates(
    problem: {
      category: ProblemCategory;
      subcategory: string | null;
      createdAt: Date;
    },
    candidates: CandidateRow[],
  ) {
    const config = this.settings;

    const scored = candidates.map((candidate) => {
      const ageGapDays = Math.max(
        0,
        (problem.createdAt.getTime() - candidate.createdAt.getTime()) / 86_400_000,
      );

      const result = this.scoring.score(
        {
          textSimilarity: Number(candidate.textSimilarity),
          // No image encoder exists yet. Passing `null` — rather than a
          // fabricated number — is what lets the scorer renormalise honestly.
          imageSimilarity: null,
          distanceMeters:
            candidate.distanceMeters === null ? null : Number(candidate.distanceMeters),
          category: problem.category,
          candidateCategory: candidate.category,
          subcategory: problem.subcategory,
          candidateSubcategory: candidate.subcategory,
          ageGapDays,
        },
        config,
      );

      return { candidate, ...result };
    });

    return (
      scored
        .filter((entry) => entry.verdict !== null)
        // Deterministic ordering: score first, then public id, so two pairs
        // with identical scores never swap places between runs.
        .sort(
          (a, b) =>
            b.combinedScore - a.combinedScore ||
            a.candidate.publicId.localeCompare(b.candidate.publicId),
        )
        .slice(0, config.resultLimit)
    );
  }

  /**
   * Persists the scored pairs.
   *
   * Upsert on the ordered pair, so re-running a check updates the scores rather
   * than accumulating a row per run.
   *
   * A pair a human has already ruled on is left alone entirely. Re-scoring it
   * would let the algorithm overwrite a person's decision the next time
   * anything triggered a re-check — which is precisely the thing this whole
   * design is built to prevent.
   */
  private async persistCandidates(
    problemId: string,
    scored: ReturnType<DuplicateDetectionService['scoreCandidates']>,
  ): Promise<number> {
    let stored = 0;

    // Retract what this run no longer believes. Without it a re-check is
    // purely additive: retuned thresholds, an edited report or a better model
    // would leave every previously-suggested pair on screen forever, and the
    // list would only ever grow. Human verdicts are exempt — a person's
    // decision is not the algorithm's to withdraw.
    await this.prisma.problemDuplicateCandidate.deleteMany({
      where: {
        problemId,
        status: { notIn: ['CONFIRMED_DUPLICATE', 'REJECTED', 'NOT_DUPLICATE'] },
        candidateProblemId: { notIn: scored.map((entry) => entry.candidate.id) },
      },
    });

    for (const entry of scored) {
      const existing = await this.prisma.problemDuplicateCandidate.findUnique({
        where: {
          problemId_candidateProblemId: {
            problemId,
            candidateProblemId: entry.candidate.id,
          },
        },
        select: { id: true, status: true },
      });

      if (existing && isHumanReviewed(existing.status)) continue;

      const signals = {
        textSimilarity: entry.signals.text,
        imageSimilarity: entry.signals.image,
        geographicSimilarity: entry.signals.geographic,
        categorySimilarity: entry.signals.category,
        combinedScore: entry.combinedScore,
        confidence: entry.confidence,
        // The model's opinion, never `CONFIRMED_DUPLICATE`. A score cannot
        // confirm anything; only a person can.
        status:
          entry.verdict === 'LIKELY_DUPLICATE'
            ? ('LIKELY_DUPLICATE' as const)
            : ('PENDING' as const),
      };

      await this.prisma.problemDuplicateCandidate.upsert({
        where: {
          problemId_candidateProblemId: {
            problemId,
            candidateProblemId: entry.candidate.id,
          },
        },
        update: signals,
        create: { problemId, candidateProblemId: entry.candidate.id, ...signals },
      });

      stored += 1;
    }

    return stored;
  }

  // ======================================================== reads and actions

  /**
   * The duplicate check for one problem, as the client sees it.
   *
   * The job's state comes from its `ProblemAiAnalysis` row and the candidates
   * from their own table, so a completed check with nothing to show is
   * distinguishable from a check that never ran — a distinction the UI needs
   * and a single "candidates" query could not make.
   */
  async findCheck(
    problemId: string,
    resolveUrl: (key: string) => Promise<string> | string,
  ): Promise<DuplicateCheckView> {
    const [job, rows] = await Promise.all([
      this.prisma.problemAiAnalysis.findFirst({
        where: { problemId, analysisType: 'DUPLICATE_ANALYSIS' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.problemDuplicateCandidate.findMany({
        where: {
          problemId,
          // A pair a person ruled out stays recorded — the negatives are what
          // the thresholds will eventually be tuned against — but it is not
          // shown back to them as a live suggestion.
          status: { notIn: ['NOT_DUPLICATE', 'REJECTED'] },
        },
        orderBy: [{ combinedScore: 'desc' }, { createdAt: 'asc' }],
        take: this.settings.resultLimit,
        include: {
          candidateProblem: {
            include: {
              images: {
                where: { deletedAt: null },
                orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
                take: 1,
              },
            },
          },
        },
      }),
    ]);

    const candidates = await Promise.all(
      rows.map((row) => toSimilarProblemView(row, this.settings, resolveUrl)),
    );

    const raw = (job?.rawResult ?? {}) as { comparedCount?: unknown };

    return {
      // No job row means the check has not been queued — reports filed before
      // this milestone are the realistic case. `PENDING` is the honest answer:
      // nothing has been checked yet.
      status: job?.processingStatus ?? 'PENDING',
      candidates,
      comparedCount: typeof raw.comparedCount === 'number' ? raw.comparedCount : 0,
      errorMessage: job?.errorMessage ?? null,
      checkedAt: job?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * Records that a person believes two reports describe the same issue.
   *
   * **Only a person reaches this.** The detector's ceiling is
   * `LIKELY_DUPLICATE`; `CONFIRMED_DUPLICATE` exists solely as the record of a
   * human decision, and nothing in the scoring path can write it.
   *
   * The newer problem is linked to the older one and marked `DUPLICATE`.
   * Neither report is deleted: the newer one is evidence that the problem is
   * still there, and the count of people who hit it matters. Transferring
   * supporters and comments onto the canonical report is a merge, which is a
   * later milestone.
   */
  async confirm(
    candidateId: string,
    problemId: string,
    reviewer: { id: string },
  ): Promise<void> {
    const candidate = await this.loadPair(candidateId, problemId);

    await this.prisma.$transaction(async (tx) => {
      await tx.problemDuplicateCandidate.update({
        where: { id: candidate.id },
        data: {
          status: 'CONFIRMED_DUPLICATE',
          reviewedById: reviewer.id,
          reviewedAt: new Date(),
        },
      });

      await tx.problem.update({
        where: { id: problemId },
        data: { duplicateOfId: candidate.candidateProblemId, status: 'DUPLICATE' },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: reviewer.id,
          action: 'PROBLEM_DUPLICATE_CONFIRMED',
          entityType: 'Problem',
          entityId: problemId,
          metadata: {
            duplicateOfId: candidate.candidateProblemId,
            candidateId: candidate.id,
            // The score at the time of the decision. Recorded so a threshold
            // change later cannot rewrite the basis a person acted on.
            combinedScore: candidate.combinedScore?.toString() ?? null,
          },
        },
      });
    });

    this.logger.log(
      `Problem ${problemId} confirmed as duplicate of ${candidate.candidateProblemId} ` +
        `by ${reviewer.id}`,
    );
  }

  /**
   * Records that a person believes the two reports are different problems.
   *
   * The row is kept rather than deleted. Confirmed negatives are the scarcer
   * half of the training data any learned scorer will need, and deleting them
   * would also mean re-suggesting the same rejected pair on the next check.
   */
  async reject(
    candidateId: string,
    problemId: string,
    reviewer: { id: string },
  ): Promise<void> {
    const candidate = await this.loadPair(candidateId, problemId);

    await this.prisma.problemDuplicateCandidate.update({
      where: { id: candidate.id },
      data: {
        status: 'NOT_DUPLICATE',
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
      },
    });

    this.logger.log(
      `Duplicate pair ${candidate.id} marked not-a-duplicate by ${reviewer.id}`,
    );
  }

  /**
   * Loads a pair, enforcing that it belongs to the named problem.
   *
   * The check on `problemId` is the one that matters: without it, a caller
   * authorised on their own report could pass any candidate id and rule on a
   * pair belonging to someone else's. Same 404 for "no such pair" and "not
   * yours", so the endpoint does not confirm which ids exist.
   */
  private async loadPair(candidateId: string, problemId: string) {
    const candidate = await this.prisma.problemDuplicateCandidate.findFirst({
      where: { id: candidateId, problemId },
    });

    if (!candidate) throw AppException.notFound('Duplicate candidate');

    if (isHumanReviewed(candidate.status)) {
      throw AppException.conflict('This suggestion has already been reviewed.');
    }

    return candidate;
  }

  private async markFailed(jobId: string, message: string): Promise<void> {
    await this.updateJob(jobId, {
      processingStatus: 'FAILED',
      // Written for a caller, never copied from a provider's own error text.
      errorMessage: message.slice(0, 500),
    });
  }

  /**
   * Updates the job row, tolerating its disappearance.
   *
   * A problem deleted while its check is in flight takes the job row with it by
   * cascade. That is an ordinary race, not a fault — treating it as one logged
   * a stack trace at ERROR and sent operators looking for a bug that was really
   * someone deleting a report.
   */
  private async updateJob(
    jobId: string,
    data: Parameters<PrismaService['problemAiAnalysis']['update']>[0]['data'],
  ): Promise<void> {
    const { count } = await this.prisma.problemAiAnalysis.updateMany({
      where: { id: jobId },
      data,
    });

    if (count === 0) {
      this.logger.debug(`Duplicate check ${jobId} vanished mid-run; its problem was removed.`);
    }
  }
}

/** Statuses that record a human decision, which re-scoring must not overwrite. */
export function isHumanReviewed(status: string): boolean {
  return status === 'CONFIRMED_DUPLICATE' || status === 'REJECTED' || status === 'NOT_DUPLICATE';
}

/**
 * The text that represents a problem in the vector space.
 *
 * **Only what describes the civic problem.** No reporter name, email, phone,
 * user id or account state — an embedding is a reconstructable representation
 * of its input, so anything embedded here is effectively retained in a form
 * that similarity search can surface. Locality is included because "Sector 12
 * market" genuinely disambiguates two potholes; coordinates are not, because
 * the geographic signal measures that far better than text ever could.
 */
export function buildCanonicalText(problem: {
  title: string;
  description: string;
  category: string;
  subcategory: string | null;
  city: string | null;
  state: string | null;
}): string {
  return [
    problem.title,
    problem.description,
    `Category: ${problem.category}`,
    problem.subcategory ? `Issue: ${problem.subcategory}` : null,
    [problem.city, problem.state].filter(Boolean).join(', ') || null,
  ]
    .filter(Boolean)
    .join('\n');
}
