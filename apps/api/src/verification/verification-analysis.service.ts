import { Injectable, Logger } from '@nestjs/common';
import {
  OPEN_TASK_STATUSES,
  type EvidenceConcern,
  type EvidenceFileRole,
  type EvidenceType,
  type ProblemCategory,
  type VerificationSignalView,
} from '@samadhaan/shared';
import { AiService } from '../ai/ai.service.js';
import type { AiVerification } from '../ai/dto/verification.dto.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import { Prisma } from '../generated/prisma/client.js';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service.js';
import { StorageService } from '../storage/storage.types.js';
import { forModel, perceptualHash } from './evidence-files.js';
import {
  NEAR_DUPLICATE_BITS,
  VERIFICATION_VERSION,
  completeness,
  evidenceQuality,
  hammingDistance,
  imageQuality,
  locationConsistency,
  missingEvidence,
  recommend,
  temporalConsistency,
  type Signal,
} from './verification-scoring.js';
import type { StoredGuidance } from './verification-views.js';

const MAX_AFTER_IMAGES = 4;
const MAX_BEFORE_IMAGES = 2;
const MAX_DOCUMENTS = 2;
const NULL: Signal = { value: null, confidence: 0, source: 'Unavailable' };

export type AnalysisResult = 'done' | 'retry' | 'skipped';

/**
 * Reviews one evidence item (Prompt 22):
 *
 *   claim (aiStatus PENDING → PROCESSING) ─▶ bounded context: problem, project
 *   progress, this evidence's files (images resized, ≤ 4; PDFs ≤ 2), the
 *   original report photos (≤ 2), earlier evidence (≤ 5 lines), guidance
 *   (PUBLIC + this project's knowledge, ≤ 3) ─▶ FastAPI /verify/evidence
 *   ─▶ deterministic signals (location, time, completeness, image quality)
 *   and potential concerns (duplicates, metadata) ─▶ guard rules
 *   ─▶ assessment ─▶ evidence AI_REVIEWED ─▶ audit + event
 *
 * The deterministic parts are computed even when the AI is unavailable, so a
 * reviewer always has them. Nothing here changes a problem or a project.
 */
@Injectable()
export class VerificationAnalysisService {
  private readonly logger = new Logger(VerificationAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly knowledge: KnowledgeRetrievalService,
    private readonly storage: StorageService,
    private readonly events: DomainEventBus,
    private readonly config: AppConfig,
  ) {}

  async run(evidenceId: string): Promise<AnalysisResult> {
    const settings = this.config.verification;
    const claimed = await this.prisma.$transaction(async (tx) => {
      const row = await tx.resolutionEvidence.findUnique({ where: { id: evidenceId } });
      if (!row || row.aiStatus !== 'PENDING') return null;
      const { count } = await tx.resolutionEvidence.updateMany({
        where: { id: evidenceId, aiStatus: 'PENDING' },
        data: {
          aiStatus: 'PROCESSING',
          aiAttempts: { increment: 1 },
          ...(row.status === 'SUBMITTED' ? { status: 'PROCESSING' } : {}),
        },
      });
      return count === 1 ? { ...row, aiAttempts: row.aiAttempts + 1 } : null;
    });
    if (!claimed) return 'skipped';

    const started = Date.now();
    const evidence = await this.prisma.resolutionEvidence.findUniqueOrThrow({
      where: { id: evidenceId },
      include: { files: { orderBy: { createdAt: 'asc' } } },
    });
    const [problem, project, analysis, reportImages, otherEvidence] = await Promise.all([
      this.prisma.problem.findUniqueOrThrow({ where: { id: evidence.problemId } }),
      this.prisma.resolutionProject.findUniqueOrThrow({
        where: { id: evidence.projectId },
        include: {
          tasks: { select: { title: true, status: true }, orderBy: { createdAt: 'asc' } },
          milestones: {
            select: { title: true, completedAt: true },
            orderBy: { createdAt: 'asc' },
            take: 8,
          },
          governmentOrganization: { select: { slug: true } },
        },
      }),
      this.prisma.problemAiAnalysis.findFirst({
        where: {
          problemId: evidence.problemId,
          processingStatus: 'COMPLETED',
          analysisType: { in: ['INITIAL_ANALYSIS', 'REANALYSIS'] },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.problemImage.findMany({
        where: { problemId: evidence.problemId, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        take: MAX_BEFORE_IMAGES,
      }),
      this.prisma.resolutionEvidence.findMany({
        where: {
          projectId: evidence.projectId,
          id: { not: evidence.id },
          status: { notIn: ['DRAFT', 'WITHDRAWN'] },
        },
        include: {
          files: { select: { role: true, mimeType: true, locationDistanceM: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const refs = new Map(evidence.files.map((f, i) => [f.id, `F${i + 1}`]));
    const images = evidence.files.filter((f) => f.mimeType.startsWith('image/'));
    const afterImages = images.filter((f) => f.role === 'AFTER');
    const sentImages = [
      ...afterImages,
      ...images.filter((f) => f.role !== 'AFTER'),
    ].slice(0, MAX_AFTER_IMAGES);
    const documents = evidence.files
      .filter((f) => f.mimeType === 'application/pdf')
      .slice(0, MAX_DOCUMENTS);

    // --- Deterministic signals and concerns (no model) -----------------------
    const reportHashes = await this.hashes(reportImages.map((i) => i.storageKey));
    const concerns = await this.concerns(evidence, reportHashes);
    const reportedAt = problem.submittedAt ?? problem.createdAt;
    const location = locationConsistency(
      images.map((f) => f.locationDistanceM).filter((d): d is number => d !== null),
      settings.locationNearM,
      settings.locationFarM,
    );
    const afterCaptures = images
      .filter((f) => f.role !== 'BEFORE' && f.capturedAt)
      .map((f) => f.capturedAt!);
    const temporal = temporalConsistency(afterCaptures, reportedAt, new Date());
    if (temporal.early > 0) {
      concerns.push({
        code: 'CAPTURED_BEFORE_REPORT',
        text: `Potential evidence concern: ${temporal.early} after-photo${temporal.early === 1 ? '' : 's'} carry a capture time before the problem was reported. Metadata can be wrong; check the photo.`,
      });
    }
    if (temporal.future > 0) {
      concerns.push({
        code: 'CAPTURED_IN_FUTURE',
        text: 'Potential evidence concern: a photo’s capture time is in the future, so its metadata is unreliable.',
      });
    }
    if (
      images.some(
        (f) =>
          f.locationDistanceM !== null && f.locationDistanceM > settings.locationFarM,
      )
    ) {
      concerns.push({
        code: 'LOCATION_FAR',
        text: `Potential evidence concern: a photo’s GPS metadata is more than ${settings.locationFarM} m from the reported location.`,
      });
    }
    const checklist = missingEvidence({
      category: problem.category as ProblemCategory,
      reportPhotos: reportImages.length,
      evidence: [
        {
          evidenceType: evidence.evidenceType as EvidenceType,
          files: evidence.files.map((f) => ({
            role: f.role as EvidenceFileRole,
            mimeType: f.mimeType,
            locationDistanceM: f.locationDistanceM,
          })),
        },
        ...otherEvidence
          .filter((e) => e.status !== 'REJECTED')
          .map((e) => ({
            evidenceType: e.evidenceType as EvidenceType,
            files: e.files.map((f) => ({
              role: f.role as EvidenceFileRole,
              mimeType: f.mimeType,
              locationDistanceM: f.locationDistanceM,
            })),
          })),
      ],
      locationNearM: settings.locationNearM,
    });

    // --- Supporting guidance (RAG): context for the AI, never a decision ----
    const guidance = await this.guidance(problem, evidence.projectId);

    // --- The AI review ---------------------------------------------------------
    let ai: AiVerification | null = null;
    let status: 'COMPLETED' | 'UNAVAILABLE' | 'FAILED' = 'UNAVAILABLE';
    let failureMessage: string | null = null;
    if (settings.aiEnabled) {
      const before = await Promise.all(
        reportImages.map(async (image, i) => {
          const bytes = await this.storage.get(image.storageKey).catch(() => null);
          return bytes
            ? {
                ref: `B${i + 1}`,
                image: {
                  media_type: 'image/jpeg',
                  data: await forModel(bytes, settings.imageMaxPx),
                },
              }
            : null;
        }),
      );
      const after = await Promise.all(
        sentImages.map(async (file) => {
          const bytes = await this.storage.get(file.storageKey).catch(() => null);
          return bytes
            ? {
                ref: refs.get(file.id)!,
                image: {
                  media_type: 'image/jpeg',
                  data: await forModel(bytes, settings.imageMaxPx),
                },
              }
            : null;
        }),
      );
      const docs = await Promise.all(
        documents.map(async (file) => {
          const bytes = await this.storage.get(file.storageKey).catch(() => null);
          return bytes
            ? { ref: refs.get(file.id)!, file_base64: bytes.toString('base64') }
            : null;
        }),
      );
      const beforeImages = before.filter((b): b is NonNullable<typeof b> => b !== null);
      const known = new Set([
        ...refs.values(),
        ...beforeImages.map((b) => b.ref),
        ...guidance.map((_, i) => `G${i + 1}`),
      ]);
      const raw = (analysis?.rawResult ?? {}) as { observations?: unknown };
      const openTasks = project.tasks.filter((t) =>
        (OPEN_TASK_STATUSES as readonly string[]).includes(t.status),
      ).length;
      const completed = project.tasks.filter((t) => t.status === 'COMPLETED').length;
      const countable = project.tasks.filter((t) => t.status !== 'CANCELLED').length;
      const outcome = await this.ai.verifyEvidence(
        {
          evidence_id: evidence.id,
          problem: {
            public_id: problem.publicId,
            title: problem.title.slice(0, 200),
            description: problem.description.slice(0, 4000),
            category: problem.category,
            subcategory: problem.subcategory?.slice(0, 120) ?? null,
            analysis_summary: analysis?.summary?.slice(0, 600) ?? null,
            observations: Array.isArray(raw.observations)
              ? raw.observations
                  .filter((o): o is string => typeof o === 'string')
                  .slice(0, 5)
                  .map((o) => o.slice(0, 300))
              : [],
          },
          project: {
            name: project.name.slice(0, 200),
            status: project.status,
            task_progress: countable ? Math.round((completed / countable) * 100) : 0,
            open_tasks: openTasks,
            completed_tasks: completed,
            milestones: project.milestones.map(
              (m) => `${m.title.slice(0, 120)} — ${m.completedAt ? 'completed' : 'open'}`,
            ),
            tasks: project.tasks
              .slice(0, 10)
              .map((t) => `${t.title.slice(0, 120)} — ${t.status}`),
          },
          evidence_type: evidence.evidenceType,
          title: evidence.title,
          description: evidence.description,
          files: evidence.files.map((f) => ({
            ref: refs.get(f.id)!,
            kind: f.mimeType.startsWith('image/')
              ? 'image'
              : f.mimeType === 'application/pdf'
                ? 'document'
                : f.mimeType.startsWith('video/')
                  ? 'video'
                  : 'other',
            role: f.role,
            captured: f.capturedAt ? f.capturedAt.toISOString().slice(0, 10) : null,
            distance_from_problem_m: f.locationDistanceM,
          })),
          before_images: beforeImages,
          after_images: after.filter((a): a is NonNullable<typeof a> => a !== null),
          documents: docs.filter((d): d is NonNullable<typeof d> => d !== null),
          other_evidence: otherEvidence
            .slice(0, 5)
            .map(
              (e) =>
                `${e.evidenceType}: ${e.title.slice(0, 120)}${e.description ? ` — ${e.description.slice(0, 200)}` : ''}`,
            ),
          guidance: guidance.map((g, i) => ({
            ref: `G${i + 1}`,
            title: g.title.slice(0, 300),
            section: g.sectionTitle?.slice(0, 300) ?? null,
            excerpt: g.excerpt.slice(0, 1500),
          })),
        },
        known,
      );
      if (outcome.ok) {
        ai = outcome.verification.aiRan ? outcome.verification : null;
        status = outcome.verification.aiRan ? 'COMPLETED' : 'UNAVAILABLE';
      } else if (outcome.failure.retryable && claimed.aiAttempts < settings.maxAttempts) {
        await this.prisma.resolutionEvidence.updateMany({
          where: { id: evidenceId, aiStatus: 'PROCESSING' },
          data: {
            aiStatus: 'PENDING',
            ...(claimed.status === 'SUBMITTED' ? { status: 'SUBMITTED' } : {}),
          },
        });
        this.logger.warn(
          `Evidence ${evidenceId}: AI review attempt ${claimed.aiAttempts} failed (${outcome.failure.code}); will retry`,
        );
        return 'retry';
      } else {
        status = 'FAILED';
        failureMessage =
          'The AI review was unavailable. The evidence can be reviewed directly, or the AI review run again later.';
      }
    }

    // --- Signals, quality and the guarded recommendation ------------------------
    const aiSignal = (
      s: { value: number | null; confidence: number } | undefined,
      source: string,
    ): Signal =>
      s && s.value !== null ? { value: s.value, confidence: s.confidence, source } : NULL;
    const signals: Record<VerificationSignalView['key'], Signal> = {
      relevance: aiSignal(ai?.relevance, 'AI review of the evidence against the report'),
      completionSignals: aiSignal(
        ai?.completionSignals,
        'AI review of the photos and documents',
      ),
      visualConsistency: aiSignal(
        ai?.visualConsistency,
        'AI comparison of the report photos and evidence photos',
      ),
      documentation: aiSignal(ai?.documentation, 'AI reading of the submitted documents'),
      locationConsistency: location,
      temporalConsistency: {
        value: temporal.value,
        confidence: temporal.confidence,
        source: temporal.source,
      },
      completeness: completeness(checklist),
      imageQuality: imageQuality(images),
    };
    const quality = evidenceQuality(signals);
    const { recommendation, adjustments } = recommend({
      ai: ai?.recommendation ?? null,
      aiConfidence: ai?.confidence ?? 0,
      analysable: images.length > 0 || (ai?.documentsRead ?? 0) > 0,
      relevance: signals.relevance.value,
      location: location.value,
      concerns,
    });
    const dec = (s: Signal) => (s.value === null ? null : Number(s.value.toFixed(4)));

    const assessment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.resolutionVerificationAssessment.create({
        data: {
          evidenceId,
          projectId: evidence.projectId,
          problemId: evidence.problemId,
          status,
          relevanceScore: dec(signals.relevance),
          visualConsistencyScore: dec(signals.visualConsistency),
          completionSignalScore: dec(signals.completionSignals),
          locationConsistencyScore: dec(signals.locationConsistency),
          documentationScore: dec(signals.documentation),
          temporalConsistencyScore: dec(signals.temporalConsistency),
          completenessScore: dec(signals.completeness),
          imageQualityScore: dec(signals.imageQuality),
          evidenceQuality: quality,
          confidence: ai ? Number(ai.confidence.toFixed(4)) : null,
          aiRecommendation: ai?.recommendation ?? null,
          recommendation,
          explanation: {
            signals,
            supporting: ai?.supporting ?? [],
            remainingIssues: ai?.remainingIssues ?? [],
            adjustments,
          } as unknown as Prisma.InputJsonValue,
          evidenceReferences: Object.fromEntries([...refs].map(([id, ref]) => [ref, id])),
          concerns: concerns as unknown as Prisma.InputJsonValue,
          missingEvidence: checklist as unknown as Prisma.InputJsonValue,
          guidance: guidance.map(
            ({ excerpt: _excerpt, ...g }) => g,
          ) as unknown as Prisma.InputJsonValue,
          modelName: ai?.modelName ?? null,
          modelVersion: ai?.modelVersion ?? null,
          promptVersion: ai?.promptVersion ?? null,
          embeddingModel: guidance[0]?.embeddingModel ?? null,
          embeddingVersion: guidance[0]?.embeddingVersion ?? null,
          verificationVersion: VERIFICATION_VERSION,
          processingMs: Date.now() - started,
          failureMessage,
        },
      });
      await tx.resolutionEvidence.updateMany({
        where: { id: evidenceId, aiStatus: 'PROCESSING' },
        data: {
          aiStatus: status,
          ...(claimed.status === 'SUBMITTED' ? { status: 'AI_REVIEWED' } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          action: 'EVIDENCE_AI_REVIEWED',
          entityType: 'ResolutionEvidence',
          entityId: evidenceId,
          metadata: {
            projectId: evidence.projectId,
            problemId: evidence.problemId,
            evidenceTitle: evidence.title,
            assessmentId: created.id,
            status,
            recommendation,
            evidenceQuality: quality,
            concerns: concerns.map((c) => c.code),
            verificationVersion: VERIFICATION_VERSION,
          },
        },
      });
      return created;
    });

    this.logger.log(
      `Evidence ${evidenceId}: AI review ${status}, recommendation ${recommendation ?? 'none'}, ` +
        `quality ${quality ?? 'n/a'}, ${concerns.length} concern(s), ${Date.now() - started} ms`,
    );
    this.events.publish({
      type: 'EVIDENCE_REVIEWED',
      evidenceId,
      evidenceTitle: evidence.title,
      projectId: evidence.projectId,
      roomId: evidence.roomId,
      problemPublicId: problem.publicId,
      governmentOrganizationId: project.governmentOrganizationId,
      governmentSlug: project.governmentOrganization.slug,
      submittedById: evidence.submittedById,
      assessmentId: assessment.id,
      recommendation,
    });
    return 'done';
  }

  /**
   * After an unexpected crash: retry while attempts remain, otherwise record
   * the AI review as failed so the evidence is never stuck — a reviewer can
   * still inspect it, and the review can be requested again.
   */
  async recover(evidenceId: string): Promise<AnalysisResult> {
    const row = await this.prisma.resolutionEvidence.findUnique({
      where: { id: evidenceId },
    });
    if (!row || row.aiStatus !== 'PROCESSING') return 'skipped';
    if (row.aiAttempts < this.config.verification.maxAttempts) {
      await this.prisma.resolutionEvidence.updateMany({
        where: { id: evidenceId, aiStatus: 'PROCESSING' },
        data: {
          aiStatus: 'PENDING',
          ...(row.status === 'PROCESSING' ? { status: 'SUBMITTED' } : {}),
        },
      });
      return 'retry';
    }
    await this.prisma.resolutionEvidence.updateMany({
      where: { id: evidenceId, aiStatus: 'PROCESSING' },
      data: {
        aiStatus: 'FAILED',
        ...(row.status === 'PROCESSING' ? { status: 'AI_REVIEWED' } : {}),
      },
    });
    return 'done';
  }

  // ------------------------------------------------------------- helpers

  private async hashes(keys: string[]): Promise<bigint[]> {
    const out: bigint[] = [];
    for (const key of keys) {
      const bytes = await this.storage.get(key).catch(() => null);
      if (bytes) out.push(await perceptualHash(bytes).catch(() => 0n));
    }
    return out.filter((h) => h !== 0n);
  }

  /** Potential concerns from file identity and similarity. Never accusations. */
  private async concerns(
    evidence: Prisma.ResolutionEvidenceGetPayload<{ include: { files: true } }>,
    reportHashes: bigint[],
  ): Promise<EvidenceConcern[]> {
    const concerns: EvidenceConcern[] = [];
    const checksums = evidence.files.map((f) => f.checksum);
    if (checksums.length > 0) {
      const [elsewhere, here] = await Promise.all([
        this.prisma.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM resolution_evidence_files f
          JOIN resolution_evidence e ON e.id = f."evidenceId"
          WHERE f.checksum = ANY (${checksums}::text[]) AND e."problemId" <> ${evidence.problemId}::uuid`,
        this.prisma.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM resolution_evidence_files f
          JOIN resolution_evidence e ON e.id = f."evidenceId"
          WHERE f.checksum = ANY (${checksums}::text[]) AND e."projectId" = ${evidence.projectId}::uuid
            AND e.id <> ${evidence.id}::uuid AND e.status <> 'DRAFT'`,
      ]);
      if ((elsewhere[0]?.n ?? 0) > 0) {
        concerns.push({
          code: 'DUPLICATE_FILE_OTHER_PROBLEM',
          text: 'Potential evidence concern: a file is identical to evidence submitted for another problem. Check before relying on it.',
        });
      }
      if ((here[0]?.n ?? 0) > 0) {
        concerns.push({
          code: 'DUPLICATE_UPLOAD',
          text: 'A file was already submitted in earlier evidence for this project.',
        });
      }
    }
    const hashed = evidence.files.filter((f) => f.perceptualHash !== null);
    for (const file of hashed) {
      const [near] = await this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM resolution_evidence_files f
        JOIN resolution_evidence e ON e.id = f."evidenceId"
        WHERE f."perceptualHash" IS NOT NULL AND e."problemId" <> ${evidence.problemId}::uuid
          AND f.checksum <> ${file.checksum}
          AND bit_count((f."perceptualHash" # ${file.perceptualHash!})::bit(64)) <= ${NEAR_DUPLICATE_BITS}`;
      if ((near?.n ?? 0) > 0) {
        concerns.push({
          code: 'NEAR_DUPLICATE_OTHER_PROBLEM',
          text: 'Potential evidence concern: a photo looks nearly identical to evidence submitted for another problem.',
        });
        break;
      }
    }
    const afterHashes = hashed
      .filter((f) => f.role === 'AFTER')
      .map((f) => f.perceptualHash!);
    if (afterHashes.some((a) => reportHashes.some((b) => hammingDistance(a, b) <= 4))) {
      concerns.push({
        code: 'AFTER_MATCHES_BEFORE',
        text: 'Potential evidence concern: an after-photo is nearly identical to the citizen’s original report photo, so it may not show any change.',
      });
    }
    return concerns;
  }

  private async guidance(
    problem: {
      category: string;
      subcategory: string | null;
      title: string;
      city: string | null;
    },
    projectId: string,
  ): Promise<
    Array<
      StoredGuidance & {
        excerpt: string;
        embeddingModel: string;
        embeddingVersion: string;
      }
    >
  > {
    const topK = this.config.verification.guidanceTopK;
    if (topK === 0 || !this.config.rag.enabled) return [];
    try {
      const category = problem.category.toLowerCase().replace('_', ' ');
      const result = await this.knowledge.retrieve({
        semanticQuery: `${category} ${problem.subcategory ?? ''} completion criteria repair standard ${problem.title}`,
        keywordQuery: `${category} ${problem.title}`,
        scope: {
          userId: '00000000-0000-0000-0000-000000000000',
          officeIds: [],
          organizationIds: [],
          projectId,
          only: ['PUBLIC', 'PROJECT'],
        },
        context: { kind: 'PROJECT', category: problem.category, city: problem.city },
        topK,
      });
      return result.passages.map((p) => ({
        sourceId: p.sourceId,
        chunkId: p.chunkId,
        title: p.title,
        sectionTitle: p.sectionTitle,
        excerpt: p.content,
        embeddingModel: result.embeddingModel,
        embeddingVersion: result.embeddingVersion,
      }));
    } catch {
      return [];
    }
  }
}
