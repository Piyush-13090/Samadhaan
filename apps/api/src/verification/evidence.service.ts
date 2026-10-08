import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  EVIDENCE_FILES_MAX,
  VERIFICATION_LIMITATIONS,
  canTransitionEvidence,
  type EvidenceFileRole,
  type EvidenceStatus,
  type EvidenceType,
  type EvidenceView,
  type ProblemCategory,
  type ProblemStatus,
  type ProjectVerificationView,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import { Prisma } from '../generated/prisma/client.js';
import { ProjectsService, type ProjectContext } from '../resolution/projects.service.js';
import { StorageService } from '../storage/storage.types.js';
import {
  EVIDENCE_STORAGE_PREFIX,
  MAX_BYTES,
  STORED_EXTENSION,
  detectEvidenceType,
  extensionMatches,
  processImage,
  safeFileName,
  sha256,
} from './evidence-files.js';
import { missingEvidence } from './verification-scoring.js';
import { VerificationJobsService } from './verification-jobs.service.js';
import {
  EVIDENCE_INCLUDE,
  evidenceView,
  guidanceChecker,
  requestView,
  verificationTimeline,
  type EvidenceRow,
} from './verification-views.js';

/** Evidence that may be part of a new verification request. */
const REVIEWABLE: EvidenceStatus[] = ['AI_REVIEWED', 'NEEDS_MORE_EVIDENCE'];
const IN_REVIEW: EvidenceStatus[] = ['SUBMITTED', 'PROCESSING'];
const REQUEST_INCLUDE = {
  requestedBy: { select: { fullName: true } },
  _count: { select: { evidence: true } },
} as const;

/**
 * Completion evidence, from the assigned organisation's side (Prompt 22).
 *
 * Access is the project's (ProjectsService.resolve): active members of the
 * assigned organisation, and officials of the allocating office within its
 * jurisdiction — everyone else gets 404. Only the organisation side creates,
 * uploads, submits or withdraws evidence; the government side reads submitted
 * evidence and decides (GovernmentVerificationService). Every relationship —
 * project, problem, room, allocation, organisation — is copied from the
 * project on the server, never taken from the request.
 */
@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly storage: StorageService,
    private readonly events: DomainEventBus,
    private readonly jobs: VerificationJobsService,
    private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------- access

  /** The evidence and the caller's project context. Drafts are the organisation's own. */
  async resolve(
    evidenceId: string,
    user: RequestUser,
  ): Promise<{ evidence: EvidenceRow; context: ProjectContext }> {
    const evidence = await this.prisma.resolutionEvidence.findUnique({
      where: { id: evidenceId },
      include: EVIDENCE_INCLUDE,
    });
    if (!evidence) throw AppException.notFound('Evidence');
    const context = await this.projects.resolve(evidence.projectId, user).catch(() => {
      throw AppException.notFound('Evidence');
    });
    if (evidence.status === 'DRAFT' && context.room.side !== 'ORGANIZATION') {
      throw AppException.notFound('Evidence');
    }
    return { evidence, context };
  }

  private requireOrganization(context: ProjectContext): void {
    if (context.room.side !== 'ORGANIZATION') {
      throw AppException.forbidden(
        'Only the assigned organisation submits completion evidence.',
      );
    }
  }

  private async requireOpenForEvidence(context: ProjectContext): Promise<void> {
    if (!context.isEditable || context.project.status === 'PLANNED') {
      throw AppException.conflict(
        'Evidence can be added while the project is active or paused.',
      );
    }
    const problem = await this.prisma.problem.findUniqueOrThrow({
      where: { id: context.project.problemId },
      select: { status: true },
    });
    if (problem.status !== 'IN_PROGRESS') {
      throw AppException.conflict('This problem is not awaiting resolution.');
    }
  }

  private canEditDraft(
    evidence: EvidenceRow,
    context: ProjectContext,
    user: RequestUser,
  ): boolean {
    return (
      context.room.side === 'ORGANIZATION' &&
      evidence.status === 'DRAFT' &&
      (evidence.submittedById === user.id || context.canManage)
    );
  }

  // ------------------------------------------------------------ writing

  async create(
    context: ProjectContext,
    input: {
      evidenceType: EvidenceType;
      title: string;
      description: string | null;
      replacesEvidenceId?: string;
    },
    user: RequestUser,
  ): Promise<EvidenceView> {
    this.requireOrganization(context);
    await this.requireOpenForEvidence(context);
    const { project } = context;

    let version = 1;
    if (input.replacesEvidenceId) {
      const previous = await this.prisma.resolutionEvidence.findFirst({
        where: { id: input.replacesEvidenceId, projectId: project.id },
        include: { replacedBy: { select: { id: true } } },
      });
      if (!previous) throw AppException.notFound('Evidence to replace');
      if (previous.replacedBy)
        throw AppException.conflict('That evidence already has a newer version.');
      if (
        !['AI_REVIEWED', 'NEEDS_MORE_EVIDENCE', 'REJECTED', 'WITHDRAWN'].includes(
          previous.status,
        )
      ) {
        throw AppException.conflict(
          'Only reviewed, returned, rejected or withdrawn evidence can be replaced.',
        );
      }
      version = previous.version + 1;
    }

    const created = await this.prisma.resolutionEvidence
      .create({
        data: {
          projectId: project.id,
          problemId: project.problemId,
          roomId: project.roomId,
          allocationId: project.allocationId,
          organizationId: project.assignedOrganizationId,
          submittedById: user.id,
          evidenceType: input.evidenceType,
          title: input.title,
          description: input.description,
          version,
          replacesEvidenceId: input.replacesEvidenceId ?? null,
        },
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw AppException.conflict('That evidence already has a newer version.');
        }
        throw error;
      });
    return this.view(created.id, user);
  }

  /** One file into a draft. The bytes decide the type; images lose their metadata. */
  async uploadFile(
    evidenceId: string,
    file: { buffer: Buffer; originalname?: string; size: number },
    role: EvidenceFileRole | undefined,
    user: RequestUser,
  ): Promise<EvidenceView> {
    const { evidence, context } = await this.resolve(evidenceId, user);
    if (!this.canEditDraft(evidence, context, user)) {
      throw AppException.conflict('Files can be added to your own draft evidence only.');
    }
    if (evidence.files.length >= EVIDENCE_FILES_MAX) {
      throw AppException.badRequest(
        `Evidence can carry at most ${EVIDENCE_FILES_MAX} files.`,
      );
    }
    const type = detectEvidenceType(file.buffer);
    if (!type) {
      throw AppException.badRequest(
        'Upload a JPEG, PNG or WebP photo, a PDF, or an MP4 video.',
      );
    }
    const name = safeFileName(file.originalname, STORED_EXTENSION[type]);
    if (file.originalname && !extensionMatches(type, file.originalname)) {
      throw AppException.badRequest("The file's extension does not match its contents.");
    }
    if (file.size > MAX_BYTES[type]) {
      throw AppException.badRequest(
        `That file is larger than ${MAX_BYTES[type] / 1024 / 1024} MB.`,
      );
    }

    const image = type.startsWith('image/');
    const resolvedRole: EvidenceFileRole =
      role ?? (type === 'application/pdf' ? 'DOCUMENT' : image ? 'AFTER' : 'OTHER');
    if (resolvedRole === 'DOCUMENT' && type !== 'application/pdf') {
      throw AppException.badRequest('Only a PDF can be a document.');
    }
    if ((resolvedRole === 'BEFORE' || resolvedRole === 'AFTER') && !image) {
      throw AppException.badRequest('Before and after evidence must be photos.');
    }

    let processed: Awaited<ReturnType<typeof processImage>> | null = null;
    if (image) {
      try {
        processed = await processImage(file.buffer, type);
      } catch {
        throw AppException.badRequest('That image could not be read.');
      }
    }
    const stored = processed?.stored ?? file.buffer;
    const key = `${EVIDENCE_STORAGE_PREFIX}${evidence.id}/${randomBytes(16).toString('hex')}.${STORED_EXTENSION[type]}`;
    await this.storage.put({ key, body: stored, contentType: type });

    try {
      let distance: number | null = null;
      if (processed?.gps) {
        const [row] = await this.prisma.$queryRaw<Array<{ d: number | null }>>`
          SELECT ST_Distance(
            p.location,
            ST_SetSRID(ST_MakePoint(${processed.gps.longitude}, ${processed.gps.latitude}), 4326)::geography
          ) AS d
          FROM problems p WHERE p.id = ${evidence.problemId}::uuid
        `;
        distance =
          row?.d === null || row?.d === undefined ? null : Math.round(Number(row.d));
      }
      await this.prisma.resolutionEvidenceFile.create({
        data: {
          evidenceId: evidence.id,
          role: resolvedRole,
          storageKey: key,
          originalFileName: name,
          mimeType: type,
          fileSize: stored.length,
          checksum: sha256(file.buffer),
          storedChecksum: sha256(stored),
          perceptualHash: processed?.perceptualHash ?? null,
          width: processed?.width ?? null,
          height: processed?.height ?? null,
          capturedAt: processed?.capturedAt ?? null,
          gpsLatitude: processed?.gps?.latitude ?? null,
          gpsLongitude: processed?.gps?.longitude ?? null,
          locationDistanceM: distance,
          metadata: {
            uploadedBytes: file.size,
            exifStripped: image,
            hasGps: Boolean(processed?.gps),
            device: processed?.device ?? null,
          },
        },
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    return this.view(evidence.id, user);
  }

  async removeFile(
    evidenceId: string,
    fileId: string,
    user: RequestUser,
  ): Promise<EvidenceView> {
    const { evidence, context } = await this.resolve(evidenceId, user);
    if (!this.canEditDraft(evidence, context, user)) {
      throw AppException.conflict(
        'Files can be removed from your own draft evidence only.',
      );
    }
    const file = evidence.files.find((f) => f.id === fileId);
    if (!file) throw AppException.notFound('File');
    await this.prisma.resolutionEvidenceFile.delete({ where: { id: file.id } });
    await this.storage.delete(file.storageKey).catch(() => undefined);
    return this.view(evidence.id, user);
  }

  async submit(evidenceId: string, user: RequestUser): Promise<EvidenceView> {
    const { evidence, context } = await this.resolve(evidenceId, user);
    if (!this.canEditDraft(evidence, context, user)) {
      throw AppException.conflict('Only your own draft evidence can be submitted.');
    }
    await this.requireOpenForEvidence(context);
    if (evidence.files.length === 0) {
      if (evidence.evidenceType !== 'PROGRESS_UPDATE' || !evidence.description?.trim()) {
        throw AppException.badRequest('Add at least one file before submitting.');
      }
    }
    const { count } = await this.prisma.$transaction(async (tx) => {
      const result = await tx.resolutionEvidence.updateMany({
        where: { id: evidence.id, status: 'DRAFT' },
        data: { status: 'SUBMITTED', submittedAt: new Date(), aiStatus: 'PENDING' },
      });
      if (result.count === 1) {
        await this.audit(tx, user, 'EVIDENCE_SUBMITTED', evidence, context, {
          files: evidence.files.length,
          version: evidence.version,
        });
      }
      return result;
    });
    if (count === 0) throw AppException.conflict('This evidence was already submitted.');

    this.events.publish({
      type: 'EVIDENCE_SUBMITTED',
      evidenceId: evidence.id,
      evidenceTitle: evidence.title,
      projectId: evidence.projectId,
      roomId: evidence.roomId,
      problemPublicId: await this.publicId(evidence.problemId),
      governmentOrganizationId: context.room.room.governmentOrganizationId,
      governmentSlug: context.room.room.governmentOrganization.slug,
      organizationName: context.room.room.assignedOrganization.name,
      actorUserId: user.id,
    });
    this.jobs.enqueue(evidence.id);
    return this.view(evidence.id, user);
  }

  async withdraw(evidenceId: string, user: RequestUser): Promise<EvidenceView> {
    const { evidence, context } = await this.resolve(evidenceId, user);
    if (
      context.room.side !== 'ORGANIZATION' ||
      !(evidence.submittedById === user.id || context.canManage)
    ) {
      throw AppException.forbidden(
        'Only the submitter or the organisation’s managers can withdraw evidence.',
      );
    }
    if (!canTransitionEvidence(evidence.status as EvidenceStatus, 'WITHDRAWN')) {
      throw AppException.conflict(
        `Evidence that is ${evidence.status.toLowerCase().replaceAll('_', ' ')} cannot be withdrawn.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.resolutionEvidence.updateMany({
        where: { id: evidence.id, status: evidence.status },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      });
      if (count === 0)
        throw AppException.conflict(
          'This evidence changed meanwhile. Reload and try again.',
        );
      // A draft never reached anyone; its withdrawal is not part of the record.
      if (evidence.status !== 'DRAFT') {
        await this.audit(tx, user, 'EVIDENCE_WITHDRAWN', evidence, context, {});
      }
    });
    return this.view(evidence.id, user);
  }

  /** Runs the AI review again (e.g. after it failed). Never changes the lifecycle status. */
  async analyze(evidenceId: string, user: RequestUser): Promise<EvidenceView> {
    const { evidence, context } = await this.resolve(evidenceId, user);
    const allowed = context.room.side === 'GOVERNMENT' || context.canManage;
    if (!allowed)
      throw AppException.forbidden(
        'Only the organisation’s managers or the reviewing office can do this.',
      );
    if (
      !['AI_REVIEWED', 'NEEDS_MORE_EVIDENCE', 'UNDER_GOVERNMENT_REVIEW'].includes(
        evidence.status,
      )
    ) {
      throw AppException.conflict(
        'Only submitted evidence that has been reviewed can be reviewed again.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.resolutionEvidence.updateMany({
        where: { id: evidence.id, aiStatus: { notIn: ['PENDING', 'PROCESSING'] } },
        data: { aiStatus: 'PENDING', aiAttempts: 0 },
      });
      if (count === 0)
        throw AppException.conflict('An AI review of this evidence is already running.');
      await this.audit(tx, user, 'EVIDENCE_REVIEW_REQUESTED', evidence, context, {
        side: context.room.side,
      });
    });
    this.jobs.enqueue(evidence.id);
    return this.view(evidence.id, user);
  }

  /** The organisation asks the allocating office to verify the resolution. */
  async requestVerification(
    context: ProjectContext,
    note: string | null,
    user: RequestUser,
  ): Promise<ProjectVerificationView> {
    this.requireOrganization(context);
    if (!context.canManage) {
      throw AppException.forbidden(
        'Only the organisation’s owners and admins can request verification.',
      );
    }
    const blockers = await this.requestBlockers(context);
    if (blockers.length > 0) throw AppException.conflict(blockers[0]!);
    const { project } = context;

    const request = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.resolutionVerificationRequest.create({
          data: {
            projectId: project.id,
            problemId: project.problemId,
            requestedById: user.id,
            note,
            governmentOrganizationId: project.governmentOrganizationId,
          },
        });
        const moved = await tx.resolutionEvidence.updateMany({
          where: {
            projectId: project.id,
            status: { in: REVIEWABLE },
            replacedBy: { is: null },
          },
          data: { status: 'UNDER_GOVERNMENT_REVIEW', verificationRequestId: created.id },
        });
        if (moved.count === 0)
          throw AppException.conflict('There is no reviewed evidence to verify.');
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'RESOLUTION_VERIFICATION_REQUESTED',
            entityType: 'ResolutionProject',
            entityId: project.id,
            metadata: {
              projectId: project.id,
              requestId: created.id,
              evidence: moved.count,
              organizationId: project.assignedOrganizationId,
              note,
            },
          },
        });
        return created;
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw AppException.conflict('Verification has already been requested.');
        }
        throw error;
      });

    this.events.publish({
      type: 'VERIFICATION_REQUESTED',
      requestId: request.id,
      projectId: project.id,
      roomId: project.roomId,
      problemPublicId: await this.publicId(project.problemId),
      governmentOrganizationId: project.governmentOrganizationId,
      governmentSlug: context.room.room.governmentOrganization.slug,
      organizationId: project.assignedOrganizationId,
      organizationName: context.room.room.assignedOrganization.name,
      actorUserId: user.id,
    });
    this.logger.log(`Verification requested for project ${project.id} (${request.id})`);
    return this.projectView(context, user);
  }

  private async requestBlockers(context: ProjectContext): Promise<string[]> {
    const { project } = context;
    const blockers: string[] = [];
    if (!context.isEditable) blockers.push('The project is not open.');
    else if (project.status !== 'ACTIVE')
      blockers.push('Verification can be requested while the project is active.');
    const [problem, pending, inReview, reviewable] = await Promise.all([
      this.prisma.problem.findUniqueOrThrow({
        where: { id: project.problemId },
        select: { status: true },
      }),
      this.prisma.resolutionVerificationRequest.count({
        where: { projectId: project.id, status: 'PENDING' },
      }),
      this.prisma.resolutionEvidence.count({
        where: { projectId: project.id, status: { in: IN_REVIEW } },
      }),
      this.prisma.resolutionEvidence.count({
        where: {
          projectId: project.id,
          status: { in: REVIEWABLE },
          replacedBy: { is: null },
        },
      }),
    ]);
    if (problem.status !== 'IN_PROGRESS')
      blockers.push('This problem is not awaiting resolution.');
    if (pending > 0)
      blockers.push(
        'Verification has already been requested and is awaiting the government’s decision.',
      );
    if (inReview > 0)
      blockers.push(
        `The AI review of ${inReview} evidence item${inReview === 1 ? ' is' : 's are'} still running.`,
      );
    if (reviewable === 0 && pending === 0)
      blockers.push('Submit completion evidence first.');
    return blockers;
  }

  // ------------------------------------------------------------ reading

  async view(evidenceId: string, user: RequestUser): Promise<EvidenceView> {
    const { evidence, context } = await this.resolve(evidenceId, user);
    const check = await guidanceChecker(this.prisma, evidence.projectId, [
      evidence.assessments[0]?.guidance,
    ]);
    return evidenceView(evidence, this.permissions(evidence, context, user), check);
  }

  async list(context: ProjectContext, user: RequestUser): Promise<EvidenceView[]> {
    const rows = await this.prisma.resolutionEvidence.findMany({
      where: {
        projectId: context.project.id,
        // Drafts are the organisation's working copies.
        ...(context.room.side === 'GOVERNMENT' ? { status: { not: 'DRAFT' } } : {}),
      },
      include: EVIDENCE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const check = await guidanceChecker(
      this.prisma,
      context.project.id,
      rows.map((r) => r.assessments[0]?.guidance),
    );
    return rows.map((row) =>
      evidenceView(row, this.permissions(row, context, user), check),
    );
  }

  permissions(
    evidence: EvidenceRow,
    context: ProjectContext,
    user: RequestUser,
  ): EvidenceView['permissions'] {
    const org = context.room.side === 'ORGANIZATION';
    const mine = evidence.submittedById === user.id;
    return {
      canUpload: this.canEditDraft(evidence, context, user),
      canSubmit: this.canEditDraft(evidence, context, user),
      canWithdraw:
        org &&
        (mine || context.canManage) &&
        canTransitionEvidence(evidence.status as EvidenceStatus, 'WITHDRAWN'),
      canAnalyze:
        (context.room.side === 'GOVERNMENT' || context.canManage) &&
        ['AI_REVIEWED', 'NEEDS_MORE_EVIDENCE', 'UNDER_GOVERNMENT_REVIEW'].includes(
          evidence.status,
        ) &&
        !['PENDING', 'PROCESSING'].includes(evidence.aiStatus ?? ''),
    };
  }

  async file(
    evidenceId: string,
    fileId: string,
    user: RequestUser,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const { evidence } = await this.resolve(evidenceId, user);
    const file = evidence.files.find((f) => f.id === fileId);
    if (!file) throw AppException.notFound('File');
    const buffer = await this.storage.get(file.storageKey);
    if (!buffer) throw AppException.notFound('File');
    return { buffer, mimeType: file.mimeType, fileName: file.originalFileName };
  }

  /** The project's verification state, for both sides. */
  async projectView(
    context: ProjectContext,
    user: RequestUser,
  ): Promise<ProjectVerificationView> {
    const { project } = context;
    const [evidence, requests, problem, reportPhotos] = await Promise.all([
      this.list(context, user),
      this.prisma.resolutionVerificationRequest.findMany({
        where: { projectId: project.id },
        include: REQUEST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.problem.findUniqueOrThrow({
        where: { id: project.problemId },
        select: { status: true, category: true },
      }),
      this.prisma.problemImage.count({
        where: { problemId: project.problemId, deletedAt: null },
      }),
    ]);
    const governmentName = context.room.room.governmentOrganization.name;
    const views = requests.map((r) => requestView(r, governmentName));
    const blockers =
      context.room.side === 'ORGANIZATION' ? await this.requestBlockers(context) : [];
    const active = evidence.filter(
      (e) => !['DRAFT', 'WITHDRAWN', 'REJECTED'].includes(e.status),
    );
    return {
      evidence,
      request: views.find((r) => r.status === 'PENDING') ?? null,
      history: views,
      missingEvidence: missingEvidence({
        category: problem.category as ProblemCategory,
        reportPhotos,
        evidence: active.map((e) => ({
          evidenceType: e.evidenceType,
          files: e.files.map((f) => ({
            role: f.role,
            mimeType: f.mimeType,
            locationDistanceM: f.locationDistanceM,
          })),
        })),
        locationNearM: this.config.verification.locationNearM,
      }),
      timeline: await verificationTimeline(
        this.prisma,
        project.id,
        project.governmentOrganizationId,
      ),
      canSubmitEvidence:
        context.room.side === 'ORGANIZATION' &&
        context.isEditable &&
        project.status !== 'PLANNED' &&
        problem.status === 'IN_PROGRESS',
      canRequestVerification:
        context.room.side === 'ORGANIZATION' &&
        context.canManage &&
        blockers.length === 0,
      requestBlockers: blockers,
      problemStatus: problem.status as ProblemStatus,
      limitations: VERIFICATION_LIMITATIONS,
    };
  }

  // ------------------------------------------------------------ helpers

  private async publicId(problemId: string): Promise<string> {
    const row = await this.prisma.problem.findUniqueOrThrow({
      where: { id: problemId },
      select: { publicId: true },
    });
    return row.publicId;
  }

  private audit(
    tx: Prisma.TransactionClient,
    user: RequestUser,
    action: string,
    evidence: EvidenceRow,
    context: ProjectContext,
    extra: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action,
        entityType: 'ResolutionEvidence',
        entityId: evidence.id,
        metadata: {
          projectId: evidence.projectId,
          problemId: evidence.problemId,
          evidenceTitle: evidence.title,
          organizationId:
            context.room.side === 'GOVERNMENT'
              ? context.room.organization.id
              : evidence.organizationId,
          ...extra,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
