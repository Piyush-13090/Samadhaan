import { Injectable, Logger } from '@nestjs/common';
import {
  OPEN_TASK_STATUSES,
  VERIFICATION_LIMITATIONS,
  type GovernmentVerificationView,
  type ProblemCategory,
  type ProblemStatus,
  type VerificationRecommendation,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import type { GovernmentScope } from '../government/government-access.service.js';
import { GovernmentProblemsService } from '../government/government-problems.service.js';
import { ProjectsService } from '../resolution/projects.service.js';
import { StorageService } from '../storage/storage.types.js';
import { EvidenceService } from './evidence.service.js';
import { conflicting, missingEvidence } from './verification-scoring.js';
import { verificationTimeline } from './verification-views.js';

type Decision = 'APPROVED' | 'REJECTED' | 'MORE_EVIDENCE_REQUESTED';

const AUDIT_ACTION: Record<Decision, string> = {
  APPROVED: 'RESOLUTION_APPROVED',
  REJECTED: 'RESOLUTION_REJECTED',
  MORE_EVIDENCE_REQUESTED: 'MORE_EVIDENCE_REQUESTED',
};

/**
 * The government's side of resolution verification (Prompt 22).
 *
 * Who may decide: the portal's rules (role GOVERNMENT, active membership of an
 * operational office — `GovernmentGuard`; the problem inside its jurisdiction
 * — `findInScope`) **and** that office must be the one that allocated the
 * project. Another office, even one whose area also covers the problem, gets
 * 404. The organisation cannot decide on its own resolution, and no AI output
 * decides anything: the recommendation is shown, never applied.
 */
@Injectable()
export class GovernmentVerificationService {
  private readonly logger = new Logger(GovernmentVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly governmentProblems: GovernmentProblemsService,
    private readonly projects: ProjectsService,
    private readonly evidence: EvidenceService,
    private readonly storage: StorageService,
    private readonly events: DomainEventBus,
    private readonly config: AppConfig,
  ) {}

  /** The office's project for this problem, if it allocated one. */
  private async project(scope: GovernmentScope, publicId: string) {
    const problem = await this.governmentProblems.findInScope(scope, publicId);
    const project = await this.prisma.resolutionProject.findFirst({
      where: { problemId: problem.id, governmentOrganizationId: scope.organization.id },
      orderBy: { createdAt: 'desc' },
    });
    return { problem, project };
  }

  async view(
    scope: GovernmentScope,
    publicId: string,
    user: RequestUser,
  ): Promise<GovernmentVerificationView> {
    const { problem: found, project } = await this.project(scope, publicId);
    const problem = await this.prisma.problem.findUniqueOrThrow({
      where: { id: found.id },
      include: {
        images: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
          take: 4,
        },
      },
    });
    const beforeImages = await Promise.all(
      problem.images.map(async (image) => ({
        url: await this.storage.getUrl(image.storageKey),
      })),
    );
    const base = {
      problem: {
        publicId: problem.publicId,
        title: problem.title,
        description: problem.description,
        category: problem.category as ProblemCategory,
        status: problem.status as ProblemStatus,
        reportedAt: (problem.submittedAt ?? problem.createdAt).toISOString(),
        resolvedAt: problem.resolvedAt?.toISOString() ?? null,
        beforeImages,
      },
      limitations: VERIFICATION_LIMITATIONS,
    };
    if (!project) {
      return {
        ...base,
        project: null,
        evidence: [],
        request: null,
        history: [],
        rollup: {
          recommendation: null,
          confidence: null,
          evidenceQuality: null,
          conflicting: false,
          concerns: [],
        },
        missingEvidence: [],
        timeline: [],
        canDecide: false,
        approvalBlockers: ['No resolution project from this office.'],
      };
    }

    const context = await this.projects.resolve(project.id, user);
    const [shared, tasks, milestones] = await Promise.all([
      this.evidence.projectView(context, user),
      this.prisma.resolutionTask.findMany({
        where: { projectId: project.id },
        select: { status: true },
      }),
      this.prisma.resolutionMilestone.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'asc' },
        take: 12,
        select: { title: true, completedAt: true, dueDate: true },
      }),
    ]);
    const open = tasks.filter((t) =>
      (OPEN_TASK_STATUSES as readonly string[]).includes(t.status),
    ).length;
    const completed = tasks.filter((t) => t.status === 'COMPLETED').length;
    const countable = tasks.filter((t) => t.status !== 'CANCELLED').length;

    // The roll-up: the latest review among the evidence under consideration,
    // with any disagreement between reviews flagged.
    const considered = shared.evidence.filter((e) =>
      shared.request
        ? e.status === 'UNDER_GOVERNMENT_REVIEW'
        : !['DRAFT', 'WITHDRAWN', 'REJECTED'].includes(e.status),
    );
    const reviews = considered
      .map((e) => e.assessment)
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = reviews.find((a) => a.recommendation !== null) ?? reviews[0] ?? null;
    const recs = reviews
      .map((a) => a.recommendation)
      .filter((r): r is VerificationRecommendation => r !== null);
    const concerns = reviews.flatMap((a) => a.concerns);
    const unique = [...new Map(concerns.map((c) => [c.code, c])).values()];
    const isConflicting = conflicting(recs);
    if (isConflicting) {
      unique.push({
        code: 'CONFLICTING_ASSESSMENTS',
        text: 'The AI reviews of different evidence disagree. Inspect each item.',
      });
    }

    const approvalBlockers: string[] = [];
    if (!shared.request)
      approvalBlockers.push('The organisation has not requested verification.');
    if (project.status !== 'ACTIVE') approvalBlockers.push('The project is not active.');
    if (open > 0) {
      approvalBlockers.push(
        `${open} task${open === 1 ? ' is' : 's are'} still open. The organisation must complete or cancel ${open === 1 ? 'it' : 'them'} before approval.`,
      );
    }
    if (problem.status !== 'IN_PROGRESS')
      approvalBlockers.push('The problem is not in progress.');

    return {
      ...base,
      project: {
        id: project.id,
        roomId: project.roomId,
        name: project.name,
        status: project.status,
        organizationName: context.room.room.assignedOrganization.name,
        taskProgress: countable ? Math.round((completed / countable) * 100) : 0,
        openTasks: open,
        completedTasks: completed,
        milestones: milestones.map((m) => ({
          title: m.title,
          completed: m.completedAt !== null,
          dueDate: m.dueDate ? m.dueDate.toISOString().slice(0, 10) : null,
        })),
      },
      evidence: shared.evidence,
      request: shared.request,
      history: shared.history,
      rollup: {
        recommendation: latest?.recommendation ?? null,
        confidence: latest?.confidence ?? null,
        evidenceQuality: latest?.evidenceQuality ?? null,
        conflicting: isConflicting,
        concerns: unique,
      },
      missingEvidence: shared.missingEvidence.length
        ? shared.missingEvidence
        : missingEvidence({
            category: problem.category as ProblemCategory,
            reportPhotos: problem.images.length,
            evidence: [],
            locationNearM: this.config.verification.locationNearM,
          }),
      timeline: await verificationTimeline(
        this.prisma,
        project.id,
        project.governmentOrganizationId,
      ),
      canDecide: shared.request !== null,
      approvalBlockers,
    };
  }

  async decide(
    scope: GovernmentScope,
    publicId: string,
    decision: Decision,
    text: { reason: string | null; note: string | null },
    user: RequestUser,
  ): Promise<GovernmentVerificationView> {
    const { problem, project } = await this.project(scope, publicId);
    if (!project) throw AppException.notFound('Resolution project');
    if (decision !== 'APPROVED' && !text.reason) {
      throw AppException.badRequest('Give a reason the organisation can act on.');
    }
    const request = await this.prisma.resolutionVerificationRequest.findFirst({
      where: { projectId: project.id, status: 'PENDING' },
    });
    if (!request)
      throw AppException.conflict('There is no pending verification request.');
    // The approving official's own project context (government side).
    const context = await this.projects.resolve(project.id, user);
    const now = new Date();

    const { publishProject, submitterIds } = await this.prisma.$transaction(
      async (tx) => {
        const { count } = await tx.resolutionVerificationRequest.updateMany({
          where: { id: request.id, status: 'PENDING' },
          data: {
            status: decision,
            decidedById: user.id,
            decidedAt: now,
            decisionReason: text.reason,
            decisionNote: text.note,
          },
        });
        if (count === 0) {
          throw AppException.conflict(
            'Someone decided on this verification meanwhile. Reload to see the decision.',
          );
        }
        const evidence = await tx.resolutionEvidence.findMany({
          where: { verificationRequestId: request.id, status: 'UNDER_GOVERNMENT_REVIEW' },
          select: { id: true, title: true, submittedById: true },
        });
        const evidenceStatus =
          decision === 'APPROVED'
            ? 'APPROVED'
            : decision === 'REJECTED'
              ? 'REJECTED'
              : 'NEEDS_MORE_EVIDENCE';
        await tx.resolutionEvidence.updateMany({
          where: { verificationRequestId: request.id, status: 'UNDER_GOVERNMENT_REVIEW' },
          data: {
            status: evidenceStatus,
            decidedAt: now,
            decisionReason: decision === 'APPROVED' ? text.note : text.reason,
          },
        });

        let publish: (() => Promise<void>) | null = null;
        if (decision === 'APPROVED') {
          // All three, or none: the problem resolved, the project completed.
          publish = await this.projects.completeOnVerification(context, user, tx);
          const resolved = await tx.problem.updateMany({
            where: { id: problem.id, status: 'IN_PROGRESS' },
            data: { status: 'RESOLVED', resolvedAt: now },
          });
          if (resolved.count === 0)
            throw AppException.conflict('The problem is no longer in progress.');
          await tx.auditLog.create({
            data: {
              actorUserId: user.id,
              action: 'PROBLEM_STATUS_CHANGED',
              entityType: 'Problem',
              entityId: problem.id,
              metadata: {
                from: 'IN_PROGRESS',
                to: 'RESOLVED',
                note: null,
                viaVerification: true,
                organizationId: scope.organization.id,
                organizationName: scope.organization.name,
              },
            },
          });
        } else if (decision === 'REJECTED') {
          for (const e of evidence) {
            await tx.auditLog.create({
              data: {
                actorUserId: user.id,
                action: 'EVIDENCE_REJECTED',
                entityType: 'ResolutionEvidence',
                entityId: e.id,
                metadata: {
                  projectId: project.id,
                  problemId: problem.id,
                  evidenceTitle: e.title,
                  organizationId: scope.organization.id,
                  reason: text.reason,
                },
              },
            });
          }
        }
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: AUDIT_ACTION[decision],
            entityType: 'ResolutionProject',
            entityId: project.id,
            metadata: {
              projectId: project.id,
              problemId: problem.id,
              requestId: request.id,
              evidence: evidence.map((e) => e.id),
              organizationId: scope.organization.id,
              organizationName: scope.organization.name,
              reason: text.reason,
              note: text.note,
            },
          },
        });
        return {
          publishProject: publish,
          submitterIds: [...new Set(evidence.map((e) => e.submittedById))],
        };
      },
    );

    // After commit: nothing is announced that could still roll back.
    if (publishProject) void publishProject();
    if (decision === 'APPROVED') {
      this.events.publish({
        type: 'PROBLEM_STATUS_CHANGED',
        problemId: problem.id,
        problemPublicId: problem.publicId,
        reporterId: problem.reporterId,
        fromStatus: 'IN_PROGRESS',
        toStatus: 'RESOLVED',
        actorUserId: user.id,
        changeId: request.id,
        reviewedBy: scope.organization.name,
      });
    }
    this.events.publish({
      type: 'VERIFICATION_DECIDED',
      requestId: request.id,
      decision,
      projectId: project.id,
      roomId: project.roomId,
      problemPublicId: problem.publicId,
      organizationId: project.assignedOrganizationId,
      governmentName: scope.organization.name,
      reason: decision === 'APPROVED' ? text.note : text.reason,
      submitterIds,
      actorUserId: user.id,
    });
    this.logger.log(
      `${problem.publicId}: verification ${decision} by ${scope.organization.slug}`,
    );
    return this.view(scope, publicId, user);
  }
}
