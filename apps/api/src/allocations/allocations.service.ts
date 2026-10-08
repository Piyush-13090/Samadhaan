import { Injectable, Logger } from '@nestjs/common';
import {
  ALLOCATION_RESPONDER_ROLES,
  isWorkspaceOrganizationType,
  type AllocationCandidate,
  type AllocationIneligibility,
  type AllocationStatus,
  type AllocationView,
  type ExpertiseLevel,
  type GovernmentAllocationPanel,
  type GovernmentAllocationView,
  type MatchReason,
  type OrganizationAllocationDetail,
  type OrganizationAllocationItem,
  type OrganizationAllocationPage,
  type ProblemAssignment,
  type ProblemCategory,
  type WorkspaceOrganizationType,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import {
  Prisma,
  type Organization,
  type OrganizationMember,
} from '../generated/prisma/client.js';
import { coarseArea } from '../problems/services/problem-discovery.service.js';
import { openRoomInTransaction } from '../resolution/room-opening.js';

/** What the government side passes in: a proven office and jurisdiction. */
export interface AllocatingOffice {
  organization: Organization;
  jurisdiction: { condition: Prisma.Sql };
}

/** What the organisation side passes in: a proven membership. */
export interface RespondingOrganization {
  organization: Organization;
  membership: OrganizationMember;
}

type AllocationRow = Prisma.ProblemAllocationGetPayload<{
  include: {
    organization: { select: { slug: true; name: true; type: true; logoUrl: true } };
    governmentOrganization: { select: { name: true } };
    allocatedBy: { select: { fullName: true } };
    resolutionRoom: { select: { id: true } };
  };
}>;

const GOVERNMENT_INCLUDE = {
  organization: { select: { slug: true, name: true, type: true, logoUrl: true } },
  governmentOrganization: { select: { name: true } },
  allocatedBy: { select: { fullName: true } },
  resolutionRoom: { select: { id: true } },
} satisfies Prisma.ProblemAllocationInclude;

/**
 * Government allocation (Prompt 16).
 *
 * The state machine is PENDING → ACCEPTED | DECLINED | CANCELLED, and every
 * move is a **conditional update** — `WHERE id = ? AND status = 'PENDING'` —
 * whose affected-row count decides who won. Two people acting on the same
 * allocation at once (an official cancelling while the organisation accepts)
 * cannot both succeed; the loser is told what happened.
 *
 * "One active allocation per problem" is the partial unique index
 * `problem_allocations_one_active`, not an application check: two officials
 * allocating the same problem at once cannot both insert. The problem row is
 * also locked while an allocation is created, so the checks and the insert
 * see one consistent state.
 *
 * Acceptance moves the allocation to ACCEPTED and the problem from VERIFIED
 * to IN_PROGRESS in one transaction; if either update finds the wrong state,
 * both roll back.
 */
@Injectable()
export class AllocationsService {
  private readonly logger = new Logger(AllocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
  ) {}

  // ============================================================ government

  /**
   * Allocates a verified problem in the office's jurisdiction to an eligible
   * organisation. The office and the acting official come from the session;
   * the organisation id is checked against the database, never trusted.
   */
  async create(
    office: AllocatingOffice,
    publicId: string,
    input: {
      organizationId: string;
      instructions: string | null;
      internalReason: string | null;
    },
    user: RequestUser,
  ): Promise<GovernmentAllocationView> {
    const allocation = await this.prisma.$transaction(async (tx) => {
      // Locks the problem row for the rest of the transaction: allocation,
      // acceptance and review all touch it, and they serialise here.
      const [problem] = await tx.$queryRaw<
        Array<{ id: string; status: string; publicId: string }>
      >(Prisma.sql`
        SELECT p.id, p.status::text AS status, p."publicId"
        FROM problems p
        WHERE upper(p."publicId") = upper(${publicId})
          AND p."deletedAt" IS NULL
          AND p.status <> 'DRAFT'
          AND ${office.jurisdiction.condition}
        FOR UPDATE OF p
      `);
      if (!problem) throw AppException.notFound('Problem');

      if (problem.status !== 'VERIFIED') {
        throw AppException.conflict(
          'Only a verified problem can be allocated. Review and verify it first.',
        );
      }

      const target = await tx.organization.findFirst({
        where: { id: input.organizationId, deletedAt: null },
      });
      const ineligible = target ? ineligibility(target) : 'INACTIVE';
      if (!target || ineligible) {
        throw AppException.badRequest(
          ineligible === 'NOT_VERIFIED'
            ? 'Only organisations verified by Samadhaan can receive official allocations.'
            : 'That organisation cannot receive allocations.',
        );
      }

      const active = await tx.problemAllocation.findFirst({
        where: { problemId: problem.id, status: { in: ['PENDING', 'ACCEPTED'] } },
        select: { id: true },
      });
      if (active) {
        throw AppException.conflict(
          'This problem already has an active allocation. Cancel it, or wait for a response.',
        );
      }

      let created: AllocationRow;
      try {
        created = await tx.problemAllocation.create({
          data: {
            problemId: problem.id,
            organizationId: target.id,
            governmentOrganizationId: office.organization.id,
            allocatedById: user.id,
            instructions: input.instructions,
            internalReason: input.internalReason,
          },
          include: GOVERNMENT_INCLUDE,
        });
      } catch (error) {
        // The partial unique index: another official won the race.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw AppException.conflict(
            'Another official allocated this problem moments ago.',
          );
        }
        throw error;
      }

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'ALLOCATION_CREATED',
          entityType: 'Problem',
          entityId: problem.id,
          metadata: auditMetadata(created, office.organization, {
            from: null,
            to: 'PENDING',
            note: input.internalReason ?? input.instructions,
          }),
        },
      });

      return { created, problemPublicId: problem.publicId, target };
    });

    this.publish(
      'ALLOCATION_CREATED',
      allocation.created,
      allocation.problemPublicId,
      allocation.target,
      office.organization,
      user.id,
    );
    this.logger.log(
      `${allocation.problemPublicId} allocated to ${allocation.target.slug} by ${office.organization.slug}`,
    );
    return toGovernmentView(allocation.created, office.organization.id);
  }

  /** Withdraws a pending allocation this office made. */
  async cancel(
    office: AllocatingOffice,
    allocationId: string,
    reason: string | null,
    user: RequestUser,
  ): Promise<GovernmentAllocationView> {
    const result = await this.prisma.$transaction(async (tx) => {
      const allocation = await this.findOfficeAllocation(tx, office, allocationId);

      const { count } = await tx.problemAllocation.updateMany({
        where: {
          id: allocationId,
          governmentOrganizationId: office.organization.id,
          status: 'PENDING',
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: user.id,
          cancellationReason: reason,
        },
      });
      if (count === 0) throw respondedAlready(allocation.status);

      const updated = await tx.problemAllocation.findUniqueOrThrow({
        where: { id: allocationId },
        include: { ...GOVERNMENT_INCLUDE, problem: { select: { publicId: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'ALLOCATION_CANCELLED',
          entityType: 'Problem',
          entityId: updated.problemId,
          metadata: auditMetadata(updated, office.organization, {
            from: 'PENDING',
            to: 'CANCELLED',
            note: reason,
          }),
        },
      });
      const target = await tx.organization.findUniqueOrThrow({
        where: { id: updated.organizationId },
      });
      return { updated, target };
    });

    this.publish(
      'ALLOCATION_CANCELLED',
      result.updated,
      result.updated.problem.publicId,
      result.target,
      office.organization,
      user.id,
    );
    return toGovernmentView(result.updated, office.organization.id);
  }

  /** An allocation made by this office, on a problem in its jurisdiction. */
  private async findOfficeAllocation(
    tx: Prisma.TransactionClient,
    office: AllocatingOffice,
    allocationId: string,
  ): Promise<{ id: string; status: AllocationStatus }> {
    const [row] = await tx.$queryRaw<
      Array<{ id: string; status: AllocationStatus }>
    >(Prisma.sql`
      SELECT a.id, a.status::text AS status
      FROM problem_allocations a
      JOIN problems p ON p.id = a."problemId"
      WHERE a.id = ${allocationId}::uuid
        AND a."governmentOrganizationId" = ${office.organization.id}::uuid
        AND ${office.jurisdiction.condition}
    `);
    if (!row) throw AppException.notFound('Allocation');
    return row;
  }

  /** The allocation section of the government problem view. */
  async governmentPanel(
    office: AllocatingOffice,
    problem: { id: string; status: string },
  ): Promise<GovernmentAllocationPanel> {
    const [history, matches, verifiedEntry] = await Promise.all([
      this.prisma.problemAllocation.findMany({
        where: { problemId: problem.id },
        include: GOVERNMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.organizationProblemMatch.findMany({
        where: {
          problemId: problem.id,
          status: { in: ['CALCULATED', 'STALE'] },
          organization: {
            deletedAt: null,
            type: { in: ['NGO', 'UNIVERSITY', 'INDUSTRY'] },
          },
        },
        include: { organization: true },
        orderBy: [{ finalScore: 'desc' }, { organizationId: 'asc' }],
        take: 10,
      }),
      this.prisma.auditLog.findFirst({
        where: {
          entityType: 'Problem',
          entityId: problem.id,
          action: 'PROBLEM_STATUS_CHANGED',
          metadata: { path: ['to'], equals: 'VERIFIED' },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const views = history.map((row) => toGovernmentView(row, office.organization.id));
    const active =
      views.find((view) => view.status === 'PENDING' || view.status === 'ACCEPTED') ??
      null;
    const declined = new Set(
      history.filter((row) => row.status === 'DECLINED').map((row) => row.organizationId),
    );

    return {
      canAllocate: problem.status === 'VERIFIED' && active === null,
      blockedReason:
        problem.status !== 'VERIFIED'
          ? 'NOT_VERIFIED'
          : active
            ? 'ACTIVE_ALLOCATION'
            : null,
      active,
      history: views,
      candidates: matches.map((match) =>
        toCandidate(match.organization, declined, {
          relevance: Math.round(match.finalScore * 1000) / 1000,
          explanation: match.explanation,
        }),
      ),
      verifiedAt: verifiedEntry?.createdAt.toISOString() ?? null,
    };
  }

  /**
   * Any eligible organisation by name — the official is not limited to the
   * matching engine's suggestions. Matched ones carry their evidence.
   */
  async searchCandidates(
    problemId: string,
    query: string,
  ): Promise<AllocationCandidate[]> {
    const [organizations, matches, declined] = await Promise.all([
      this.prisma.organization.findMany({
        where: {
          deletedAt: null,
          type: { in: ['NGO', 'UNIVERSITY', 'INDUSTRY'] },
          name: { contains: query, mode: 'insensitive' },
        },
        orderBy: [{ verificationStatus: 'asc' }, { name: 'asc' }],
        take: 20,
      }),
      this.prisma.organizationProblemMatch.findMany({
        where: { problemId, status: { in: ['CALCULATED', 'STALE'] } },
        select: { organizationId: true, finalScore: true, explanation: true },
      }),
      this.prisma.problemAllocation.findMany({
        where: { problemId, status: 'DECLINED' },
        select: { organizationId: true },
      }),
    ]);
    const byOrg = new Map(matches.map((match) => [match.organizationId, match]));
    const declinedIds = new Set(declined.map((row) => row.organizationId));

    return organizations.map((organization) => {
      const match = byOrg.get(organization.id);
      return toCandidate(
        organization,
        declinedIds,
        match
          ? {
              relevance: Math.round(match.finalScore * 1000) / 1000,
              explanation: match.explanation,
            }
          : null,
      );
    });
  }

  async governmentMetrics(officeId: string): Promise<{
    pendingAllocations: number;
    acceptedAllocations: number;
    declinedAllocations: number;
    openRooms: number;
  }> {
    const [groups, openRooms] = await Promise.all([
      this.prisma.problemAllocation.groupBy({
        by: ['status'],
        where: { governmentOrganizationId: officeId },
        _count: { _all: true },
      }),
      this.prisma.resolutionRoom.count({
        where: { governmentOrganizationId: officeId, status: 'OPEN' },
      }),
    ]);
    const count = (status: AllocationStatus) =>
      groups.find((group) => group.status === status)?._count._all ?? 0;
    return {
      pendingAllocations: count('PENDING'),
      acceptedAllocations: count('ACCEPTED'),
      declinedAllocations: count('DECLINED'),
      openRooms,
    };
  }

  // ========================================================== organisation

  async listForOrganization(
    context: RespondingOrganization,
    view: AllocationView,
    page: number,
    limit: number,
  ): Promise<OrganizationAllocationPage> {
    const where: Prisma.ProblemAllocationWhereInput = {
      organizationId: context.organization.id,
      ...(view === 'pending'
        ? { status: 'PENDING' }
        : view === 'active'
          ? { status: 'ACCEPTED' }
          : view === 'past'
            ? { status: { in: ['DECLINED', 'CANCELLED', 'EXPIRED'] } }
            : {}),
    };

    const [rows, totalCount] = await Promise.all([
      this.prisma.problemAllocation.findMany({
        where,
        include: ORGANIZATION_INCLUDE,
        orderBy: [{ proposedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.problemAllocation.count({ where }),
    ]);

    return {
      items: rows.map(toOrganizationItem),
      page,
      limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    };
  }

  /** One allocation, if it was made to this organisation. Otherwise 404. */
  async detailForOrganization(
    context: RespondingOrganization,
    allocationId: string,
  ): Promise<OrganizationAllocationDetail> {
    const row = await this.prisma.problemAllocation.findFirst({
      where: { id: allocationId, organizationId: context.organization.id },
      include: ORGANIZATION_DETAIL_INCLUDE,
    });
    if (!row) throw AppException.notFound('Allocation');

    const latestAnalysis = row.problem.aiAnalyses[0];
    return {
      ...toOrganizationItem(row),
      problem: {
        ...toOrganizationItem(row).problem,
        description: row.problem.description,
        address: row.problem.address,
        state: row.problem.state,
        latitude: Number(row.problem.latitude),
        longitude: Number(row.problem.longitude),
        reportedAt: row.problem.createdAt.toISOString(),
        voteCount: row.problem.voteCount,
        aiSubcategory: latestAnalysis?.subcategory ?? null,
      },
      // Government's internal reason is deliberately absent from this shape.
      instructions: row.instructions,
      responseNote: row.responseNote,
      declineReason: row.declineReason,
      cancellationReason: row.cancellationReason,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      declinedAt: row.declinedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      canRespond:
        row.status === 'PENDING' &&
        (ALLOCATION_RESPONDER_ROLES as readonly string[]).includes(
          context.membership.membershipRole,
        ),
    };
  }

  /**
   * Accepts: allocation PENDING → ACCEPTED and problem VERIFIED → IN_PROGRESS,
   * together or not at all.
   */
  async accept(
    context: RespondingOrganization,
    allocationId: string,
    note: string | null,
    user: RequestUser,
  ): Promise<OrganizationAllocationDetail> {
    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { count } = await tx.problemAllocation.updateMany({
        where: {
          id: allocationId,
          organizationId: context.organization.id,
          status: 'PENDING',
        },
        data: {
          status: 'ACCEPTED',
          respondedAt: now,
          acceptedAt: now,
          respondedById: user.id,
          responseNote: note,
        },
      });
      if (count === 0) throw await this.responseConflict(tx, context, allocationId);

      const allocation = await tx.problemAllocation.findUniqueOrThrow({
        where: { id: allocationId },
        include: {
          ...GOVERNMENT_INCLUDE,
          problem: { select: { id: true, publicId: true, reporterId: true } },
          governmentOrganization: true,
        },
      });

      // The other half of the same decision. If the problem is somehow no
      // longer VERIFIED, throwing here rolls the acceptance back too.
      const moved = await tx.problem.updateMany({
        where: { id: allocation.problemId, status: 'VERIFIED' },
        data: { status: 'IN_PROGRESS' },
      });
      if (moved.count === 0) {
        throw AppException.conflict(
          'This problem is no longer awaiting allocation, so the request cannot be accepted.',
        );
      }

      // The third part of the same decision: the resolution room. If it
      // cannot be opened, nothing above is committed either.
      const room = await openRoomInTransaction(
        tx,
        allocation,
        user.id,
        context.organization.name,
      );

      const metadata = auditMetadata(allocation, allocation.governmentOrganization, {
        from: 'PENDING',
        to: 'ACCEPTED',
        note,
        respondingOrganization: context.organization,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'ALLOCATION_ACCEPTED',
          entityType: 'Problem',
          entityId: allocation.problemId,
          metadata,
        },
      });
      const statusChange = await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'PROBLEM_STATUS_CHANGED',
          entityType: 'Problem',
          entityId: allocation.problemId,
          metadata: {
            from: 'VERIFIED',
            to: 'IN_PROGRESS',
            note: null,
            allocationId,
            viaAllocation: true,
            organizationName: context.organization.name,
            organizationId: allocation.governmentOrganizationId,
          },
        },
      });
      return { allocation, changeId: statusChange.id, roomId: room.id };
    });

    const { allocation } = result;
    this.publish(
      'ALLOCATION_ACCEPTED',
      allocation,
      allocation.problem.publicId,
      context.organization,
      allocation.governmentOrganization,
      user.id,
    );
    // The reporter and followers hear about the status change through the
    // existing event — "SAM-1023 is now in progress".
    this.events.publish({
      type: 'PROBLEM_STATUS_CHANGED',
      problemId: allocation.problem.id,
      problemPublicId: allocation.problem.publicId,
      reporterId: allocation.problem.reporterId,
      fromStatus: 'VERIFIED',
      toStatus: 'IN_PROGRESS',
      actorUserId: user.id,
      changeId: result.changeId,
    });

    return this.detailForOrganization(context, allocationId);
  }

  /** Declines with a reason. The problem stays VERIFIED for reallocation. */
  async decline(
    context: RespondingOrganization,
    allocationId: string,
    reason: string,
    user: RequestUser,
  ): Promise<OrganizationAllocationDetail> {
    const allocation = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const { count } = await tx.problemAllocation.updateMany({
        where: {
          id: allocationId,
          organizationId: context.organization.id,
          status: 'PENDING',
        },
        data: {
          status: 'DECLINED',
          respondedAt: now,
          declinedAt: now,
          respondedById: user.id,
          declineReason: reason,
        },
      });
      if (count === 0) throw await this.responseConflict(tx, context, allocationId);

      const updated = await tx.problemAllocation.findUniqueOrThrow({
        where: { id: allocationId },
        include: {
          ...GOVERNMENT_INCLUDE,
          problem: { select: { publicId: true } },
          governmentOrganization: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'ALLOCATION_DECLINED',
          entityType: 'Problem',
          entityId: updated.problemId,
          metadata: auditMetadata(updated, updated.governmentOrganization, {
            from: 'PENDING',
            to: 'DECLINED',
            note: reason,
            respondingOrganization: context.organization,
          }),
        },
      });
      return updated;
    });

    this.publish(
      'ALLOCATION_DECLINED',
      allocation,
      allocation.problem.publicId,
      context.organization,
      allocation.governmentOrganization,
      user.id,
    );
    return this.detailForOrganization(context, allocationId);
  }

  /** Why a response did not apply: not ours (404) or no longer pending (409). */
  private async responseConflict(
    tx: Prisma.TransactionClient,
    context: RespondingOrganization,
    allocationId: string,
  ): Promise<AppException> {
    const current = await tx.problemAllocation.findFirst({
      where: { id: allocationId, organizationId: context.organization.id },
      select: { status: true },
    });
    if (!current) return AppException.notFound('Allocation');
    return respondedAlready(current.status);
  }

  async organizationMetrics(organizationId: string): Promise<{
    pendingAllocations: number;
    activeAssignments: number;
    openRooms: number;
  }> {
    const [pendingAllocations, activeAssignments, openRooms] = await Promise.all([
      this.prisma.problemAllocation.count({
        where: { organizationId, status: 'PENDING' },
      }),
      this.prisma.problemAllocation.count({
        where: {
          organizationId,
          status: 'ACCEPTED',
          problem: { status: 'IN_PROGRESS', deletedAt: null },
        },
      }),
      this.prisma.resolutionRoom.count({
        where: { assignedOrganizationId: organizationId, status: 'OPEN' },
      }),
    ]);
    return { pendingAllocations, activeAssignments, openRooms };
  }

  // ================================================================ public

  /** The accepted assignment, as a public problem page shows it. */
  async publicAssignment(problemId: string): Promise<ProblemAssignment | null> {
    const row = await this.prisma.problemAllocation.findFirst({
      where: { problemId, status: 'ACCEPTED' },
      select: {
        acceptedAt: true,
        organization: { select: { slug: true, name: true, type: true, logoUrl: true } },
      },
    });
    if (!row || !row.acceptedAt || !isWorkspaceOrganizationType(row.organization.type))
      return null;
    return {
      organization: {
        slug: row.organization.slug,
        name: row.organization.name,
        type: row.organization.type,
        logoUrl: row.organization.logoUrl,
      },
      assignedAt: row.acceptedAt.toISOString(),
      progress: await this.publicProgress(problemId),
    };
  }

  /** Share of the live project's tasks completed — a public fact, nothing else from the plan. */
  private async publicProgress(problemId: string): Promise<number | null> {
    const project = await this.prisma.resolutionProject.findFirst({
      where: { problemId, status: { in: ['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    if (!project) return null;
    if (project.status === 'COMPLETED') return 100;
    const tasks = await this.prisma.resolutionTask.groupBy({
      by: ['status'],
      where: { projectId: project.id },
      _count: { _all: true },
    });
    const count = (s: string) => tasks.find((t) => t.status === s)?._count._all ?? 0;
    const total = tasks.reduce((sum, t) => sum + t._count._all, 0) - count('CANCELLED');
    return total > 0 ? Math.round((count('COMPLETED') / total) * 100) : null;
  }

  // ============================================================== events

  private publish(
    type:
      | 'ALLOCATION_CREATED'
      | 'ALLOCATION_ACCEPTED'
      | 'ALLOCATION_DECLINED'
      | 'ALLOCATION_CANCELLED',
    allocation: { id: string; problemId: string },
    problemPublicId: string,
    organization: Organization,
    office: Organization,
    actorUserId: string,
  ): void {
    this.events.publish({
      type,
      allocationId: allocation.id,
      problemId: allocation.problemId,
      problemPublicId,
      organizationId: organization.id,
      organizationSlug: organization.slug,
      organizationName: organization.name,
      governmentOrganizationId: office.id,
      governmentSlug: office.slug,
      governmentName: office.name,
      actorUserId,
    });
  }
}

// ---------------------------------------------------------------- helpers

const ORGANIZATION_INCLUDE = {
  governmentOrganization: { select: { name: true } },
  resolutionRoom: { select: { id: true } },
  problem: {
    select: {
      publicId: true,
      title: true,
      category: true,
      subcategory: true,
      severity: true,
      status: true,
      address: true,
      city: true,
    },
  },
} satisfies Prisma.ProblemAllocationInclude;

const ORGANIZATION_DETAIL_INCLUDE = {
  governmentOrganization: { select: { name: true } },
  resolutionRoom: { select: { id: true } },
  problem: {
    select: {
      publicId: true,
      title: true,
      description: true,
      category: true,
      subcategory: true,
      severity: true,
      status: true,
      address: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
      createdAt: true,
      voteCount: true,
      aiAnalyses: {
        where: { analysisType: 'INITIAL_ANALYSIS', processingStatus: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { subcategory: true },
      },
    },
  },
} satisfies Prisma.ProblemAllocationInclude;

/** Who may receive an official allocation. */
export function ineligibility(organization: {
  type: string;
  isActive: boolean;
  deletedAt: Date | null;
  verificationStatus: string;
}): AllocationIneligibility | null {
  if (organization.deletedAt !== null || !organization.isActive) return 'INACTIVE';
  if (!isWorkspaceOrganizationType(organization.type)) return 'INACTIVE';
  if (organization.verificationStatus === 'SUSPENDED') return 'SUSPENDED';
  if (organization.verificationStatus === 'REJECTED') return 'REJECTED';
  if (organization.verificationStatus !== 'VERIFIED') return 'NOT_VERIFIED';
  return null;
}

function toCandidate(
  organization: Organization,
  declined: ReadonlySet<string>,
  match: { relevance: number; explanation: unknown } | null,
): AllocationCandidate {
  const reason = ineligibility(organization);
  const explanation =
    match && typeof match.explanation === 'object' && match.explanation !== null
      ? (match.explanation as {
          reasons?: Array<{ code: string; value: number }>;
          matchedExpertise?: Array<{
            category: string;
            subcategory: string | null;
            level: string;
          }>;
        })
      : null;

  return {
    organization: {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      type: organization.type as WorkspaceOrganizationType,
      logoUrl: organization.logoUrl,
      verificationStatus: organization.verificationStatus,
      location: { city: organization.city, state: organization.state },
    },
    match: match
      ? {
          relevance: match.relevance,
          reasons: (explanation?.reasons ?? []) as MatchReason[],
          matchedExpertise: (explanation?.matchedExpertise ?? []).map((entry) => ({
            category: entry.category as ProblemCategory,
            subcategory: entry.subcategory,
            level: entry.level as ExpertiseLevel,
          })),
        }
      : null,
    eligible: reason === null,
    ineligibleReason: reason,
    previouslyDeclined: declined.has(organization.id),
  };
}

function toGovernmentView(
  row: AllocationRow,
  officeId: string,
): GovernmentAllocationView {
  const ours = row.governmentOrganizationId === officeId;
  return {
    id: row.id,
    status: row.status,
    organization: {
      slug: row.organization.slug,
      name: row.organization.name,
      type: row.organization.type as WorkspaceOrganizationType,
      logoUrl: row.organization.logoUrl,
    },
    instructions: row.instructions,
    // Another office covering the same area sees that an allocation exists,
    // not this office's reasoning or the organisation's reply to it.
    internalReason: ours ? row.internalReason : null,
    responseNote: ours ? row.responseNote : null,
    declineReason: ours ? row.declineReason : null,
    cancellationReason: ours ? row.cancellationReason : null,
    allocatedBy: {
      name: ours ? row.allocatedBy.fullName : null,
      office: row.governmentOrganization.name,
    },
    proposedAt: row.proposedAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    ownedByThisOffice: ours,
    roomId: ours ? (row.resolutionRoom?.id ?? null) : null,
  };
}

type OrganizationRow = Prisma.ProblemAllocationGetPayload<{
  include: typeof ORGANIZATION_INCLUDE;
}>;

function toOrganizationItem(row: OrganizationRow): OrganizationAllocationItem {
  return {
    id: row.id,
    status: row.status,
    problem: {
      publicId: row.problem.publicId,
      title: row.problem.title,
      category: row.problem.category,
      subcategory: row.problem.subcategory,
      severity: row.problem.severity,
      status: row.problem.status,
      area: coarseArea(row.problem.address, row.problem.city),
      city: row.problem.city,
    },
    government: { name: row.governmentOrganization.name },
    proposedAt: row.proposedAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    roomId: row.resolutionRoom?.id ?? null,
  };
}

function respondedAlready(status: AllocationStatus): AppException {
  if (status === 'CANCELLED') {
    return AppException.conflict(
      'This allocation was withdrawn by the government office.',
    );
  }
  return AppException.conflict(
    'This allocation was already responded to by another authorized user.',
  );
}

/** Audit metadata: ids, names and the stated reason. Never contact details. */
function auditMetadata(
  allocation: {
    id: string;
    organizationId: string;
    governmentOrganizationId: string;
    organization: { name: string };
  },
  office: { id: string; name: string },
  change: {
    from: AllocationStatus | null;
    to: AllocationStatus;
    note: string | null;
    respondingOrganization?: { name: string };
  },
): Prisma.InputJsonObject {
  return {
    allocationId: allocation.id,
    allocatedOrganizationId: allocation.organizationId,
    // Public name, so the timeline can say who without another lookup.
    organizationName: allocation.organization.name,
    // `organizationId` is the office, as for other government audit entries,
    // so the portal shows the note only to the office it concerns.
    organizationId: office.id,
    governmentOrganizationId: allocation.governmentOrganizationId,
    governmentName: office.name,
    from: change.from,
    to: change.to,
    note: change.note,
    ...(change.respondingOrganization
      ? { respondingOrganizationName: change.respondingOrganization.name }
      : {}),
  };
}
