import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import type { ProblemAnalysisView } from '@samadhaan/shared';
import { AiService, type AnalysisImagePayload } from '../../ai/ai.service.js';
import { AppException } from '../../common/app.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { ProblemAiAnalysis } from '../../generated/prisma/client.js';
import { StorageService } from '../../storage/storage.types.js';

/**
 * How many images are sent for analysis.
 *
 * More than three rarely adds information and every one costs tokens on every
 * retry. The primary image plus two others is enough to see the problem.
 */
const MAX_ANALYSIS_IMAGES = 3;

/**
 * Longest edge sent to the model, in pixels.
 *
 * A phone photo is often 4000px wide; vision models downscale anyway, so
 * sending the original spends tokens on detail the model discards. 1024 keeps
 * a pothole legible while cutting payload by roughly an order of magnitude.
 *
 * The stored original is never modified — this resize exists only for the
 * request. The evidence a citizen submitted stays exactly as they sent it.
 */
const ANALYSIS_IMAGE_MAX_EDGE = 1024;

/** Attempts made before an analysis is left FAILED. */
const MAX_ATTEMPTS = 3;

/**
 * Owns the AI analysis lifecycle for a problem.
 *
 * Separate from `ProblemsService` on purpose: that service owns the problem
 * domain — creating, reading, authorising — and this one owns a long-running,
 * failure-prone, externally-dependent side effect. Mixing them would mean every
 * problem read carried the weight of the analysis pipeline.
 *
 * **A failed analysis never damages the report.** The problem row is written
 * and committed before analysis begins, and nothing here can roll it back. A
 * civic report is the thing of value; the analysis is an enhancement.
 */
@Injectable()
export class ProblemAnalysisService {
  private readonly logger = new Logger(ProblemAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Queues an analysis and returns immediately.
   *
   * The citizen must not wait on a vision model to see their report confirmed,
   * so a PENDING row is created synchronously — giving the UI something real to
   * poll — and the work itself is detached.
   *
   * Deliberately in-process rather than on a separate worker: the job is one
   * HTTP call with no fan-out, and Redis already backs rate limiting rather
   * than a queue. The cost is that a restart mid-analysis leaves a PROCESSING
   * row, which `recoverStuckAnalyses` reclaims. When throughput demands a real
   * worker, `enqueue` is the only method that changes.
   */
  async enqueue(problemId: string, requestId?: string): Promise<void> {
    const analysis = await this.prisma.problemAiAnalysis.create({
      data: {
        problemId,
        modelName: 'pending',
        modelVersion: 'pending',
        analysisType: 'INITIAL_ANALYSIS',
        processingStatus: 'PENDING',
      },
    });

    // Detached on purpose: the caller is answering a citizen's HTTP request.
    void this.run(analysis.id, problemId, requestId).catch((error: unknown) => {
      this.logger.error(
        `Analysis ${analysis.id} crashed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    });
  }

  /**
   * Re-runs analysis for a problem.
   *
   * A new row rather than an update: analyses are historical records tied to
   * the model that produced them, and overwriting one would erase the evidence
   * that a model regressed.
   */
  async retry(problemId: string, requestId?: string): Promise<ProblemAnalysisView> {
    const inFlight = await this.prisma.problemAiAnalysis.findFirst({
      where: { problemId, processingStatus: { in: ['PENDING', 'PROCESSING'] } },
    });

    // Guards against a user hammering Retry and queueing several paid calls.
    if (inFlight) {
      throw AppException.conflict('An analysis is already running for this problem.');
    }

    await this.enqueue(problemId, requestId);

    const latest = await this.findLatest(problemId);
    if (!latest) throw AppException.notFound('Analysis');

    return latest;
  }

  /**
   * Runs one analysis to completion.
   *
   * Retries only what is worth retrying: the AI service labels each failure
   * `retryable`, and a permanent one — no credentials, an unsupported image —
   * is marked FAILED immediately rather than burning two more paid calls to
   * reach the same answer.
   */
  private async run(
    analysisId: string,
    problemId: string,
    requestId?: string,
  ): Promise<void> {
    const problem = await this.prisma.problem.findFirst({
      where: { id: problemId, deletedAt: null },
      include: {
        images: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
          take: MAX_ANALYSIS_IMAGES,
        },
      },
    });

    if (!problem) {
      await this.markFailed(analysisId, 'The problem no longer exists.');
      return;
    }

    await this.prisma.problemAiAnalysis.update({
      where: { id: analysisId },
      data: { processingStatus: 'PROCESSING' },
    });

    const images = await this.loadImages(problem.images);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const outcome = await this.ai.analyzeProblem({
        problemId: problem.id,
        publicId: problem.publicId,
        title: problem.title,
        description: problem.description,
        categoryHint: problem.category,
        subcategoryHint: problem.subcategory,
        // Coarse locality only. The model is told not to repeat it as fact,
        // and it never receives coordinates.
        locality: [problem.city, problem.state].filter(Boolean).join(', ') || null,
        images,
        requestId,
      });

      if (outcome.ok) {
        const { analysis } = outcome;

        await this.prisma.problemAiAnalysis.update({
          where: { id: analysisId },
          data: {
            modelName: analysis.modelName,
            modelVersion: analysis.modelVersion,
            category: analysis.category,
            subcategory: analysis.subcategory,
            severity: analysis.severity,
            urgency: analysis.urgency,
            severityScore: analysis.severityScore,
            summary: analysis.summary,
            confidence: analysis.confidence,
            // The structured result, kept whole. Never the prompt, never any
            // private model reasoning — `observations` are evidence statements
            // written for the citizen who filed the report.
            rawResult: {
              provider: analysis.provider,
              observations: analysis.observations,
              textOnly: analysis.textOnly,
              imageCount: images.length,
              attempt,
            },
            processingStatus: 'COMPLETED',
            processingMs: analysis.processingMs,
            errorMessage: null,
          },
        });

        this.logger.log(
          `Analysis completed for ${problem.publicId} ` +
            `(${analysis.provider}/${analysis.modelName}, ${analysis.category}, ` +
            `${analysis.severity}, confidence ${analysis.confidence}, ` +
            `${analysis.processingMs}ms, attempt ${attempt})`,
        );

        // The problem's own category and severity are deliberately left alone.
        // AI recommends; a reviewer decides. See docs/ARCHITECTURE.md.
        return;
      }

      const { failure } = outcome;

      if (!failure.retryable || attempt === MAX_ATTEMPTS) {
        this.logger.warn(
          `Analysis failed for ${problem.publicId}: ${failure.code} ` +
            `(attempt ${attempt}, retryable ${failure.retryable})`,
        );

        await this.markFailed(analysisId, failure.message);
        return;
      }

      // Exponential backoff, so a provider under load is not hammered.
      const delayMs = 2 ** (attempt - 1) * 1000;
      this.logger.debug(
        `Analysis for ${problem.publicId} failed with ${failure.code}; ` +
          `retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  /**
   * Reads and downsizes the images for one analysis.
   *
   * Failures are skipped rather than fatal: a report with three photos where
   * one is unreadable should still be analysed from the other two, and a
   * text-only analysis is better than none.
   */
  private async loadImages(
    images: Array<{ storageKey: string; mimeType: string }>,
  ): Promise<AnalysisImagePayload[]> {
    const payloads: AnalysisImagePayload[] = [];

    for (const image of images) {
      try {
        const bytes = await this.storage.get(image.storageKey);
        if (!bytes) continue;

        // Re-encoded to JPEG at a bounded size. The stored original is
        // untouched; this copy exists only for the request.
        const resized = await sharp(bytes)
          .rotate() // honours EXIF orientation, so the model sees it upright
          .resize({
            width: ANALYSIS_IMAGE_MAX_EDGE,
            height: ANALYSIS_IMAGE_MAX_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 82 })
          .toBuffer();

        payloads.push({ mediaType: 'image/jpeg', data: resized.toString('base64') });
      } catch (error) {
        this.logger.warn(
          `Skipping unreadable image ${image.storageKey}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    return payloads;
  }

  private async markFailed(analysisId: string, message: string): Promise<void> {
    await this.prisma.problemAiAnalysis.update({
      where: { id: analysisId },
      data: {
        processingStatus: 'FAILED',
        // Safe to show: these messages are written for a caller, never copied
        // from a provider's own error text.
        errorMessage: message.slice(0, 500),
      },
    });
  }

  /** The most recent analysis for a problem, whatever its state. */
  async findLatest(problemId: string): Promise<ProblemAnalysisView | null> {
    const analysis = await this.prisma.problemAiAnalysis.findFirst({
      where: { problemId, analysisType: 'INITIAL_ANALYSIS' },
      orderBy: { createdAt: 'desc' },
    });

    return analysis ? toAnalysisView(analysis) : null;
  }

  /**
   * Reclaims analyses left PROCESSING by a restart.
   *
   * The in-process runner dies with the process, so without this a crash would
   * leave a row spinning forever and the UI polling it indefinitely. Called at
   * startup; a real worker queue would make it unnecessary.
   */
  async recoverStuckAnalyses(olderThanMinutes = 15): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

    const { count } = await this.prisma.problemAiAnalysis.updateMany({
      where: {
        processingStatus: { in: ['PENDING', 'PROCESSING'] },
        updatedAt: { lt: cutoff },
      },
      data: {
        processingStatus: 'FAILED',
        errorMessage: 'Analysis was interrupted and did not complete.',
      },
    });

    if (count > 0) {
      this.logger.warn(`Recovered ${count} interrupted analyses`);
    }

    return count;
  }
}

/**
 * Maps a database row onto the response shape.
 *
 * An allow-list, as everywhere else. `rawResult` is deliberately not published
 * wholesale — only `observations` is lifted out of it, because that is the part
 * written for a citizen to read.
 */
export function toAnalysisView(analysis: ProblemAiAnalysis): ProblemAnalysisView {
  const raw = (analysis.rawResult ?? {}) as {
    observations?: unknown;
    textOnly?: unknown;
  };

  return {
    id: analysis.id,
    status: analysis.processingStatus,
    category: analysis.category,
    subcategory: analysis.subcategory,
    severity: analysis.severity,
    urgency: analysis.urgency,
    severityScore: analysis.severityScore === null ? null : Number(analysis.severityScore),
    summary: analysis.summary,
    confidence: analysis.confidence === null ? null : Number(analysis.confidence),
    observations: Array.isArray(raw.observations)
      ? raw.observations.filter((entry): entry is string => typeof entry === 'string')
      : [],
    modelName: analysis.modelName,
    textOnly: raw.textOnly === true,
    errorMessage: analysis.errorMessage,
    processingMs: analysis.processingMs,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
  };
}
