import { Injectable } from '@nestjs/common';
import type {
  OrganizationDashboard,
  OrganizationMemberRole,
  OrganizationWorkspace,
} from '@samadhaan/shared';
import { AllocationsService } from '../../allocations/allocations.service.js';
import { AppException } from '../../common/app.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  OrganizationAccessService,
  type WorkspaceContext,
} from '../organization-access.service.js';
import { recordOrganizationAudit } from '../organization-audit.js';
import { toMemberSummary, toPublicOrganization } from '../organization.serializer.js';
import { OrganizationProblemsService } from './organization-problems.service.js';

/** How far back "new opportunities" looks. */
const NEW_OPPORTUNITY_DAYS = 7;

/**
 * Reads for an organisation's workspace.
 *
 * Every method takes a `WorkspaceContext` — an organisation and membership
 * already proven by `OrganizationWorkspaceGuard` — so nothing here can be
 * pointed at an organisation the caller does not belong to.
 */
@Injectable()
export class OrganizationWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly problems: OrganizationProblemsService,
    private readonly allocations: AllocationsService,
  ) {}

  /** The organisation, the caller's membership, and what they may do. */
  async workspace({
    organization,
    membership,
  }: WorkspaceContext): Promise<OrganizationWorkspace> {
    const [expertise, memberCount] = await Promise.all([
      this.prisma.organizationExpertise.findMany({
        where: { organizationId: organization.id },
        orderBy: [{ level: 'desc' }, { category: 'asc' }],
      }),
      this.prisma.organizationMember.count({
        where: { organizationId: organization.id, status: 'ACTIVE' },
      }),
    ]);

    const hasCoordinates =
      organization.latitude !== null && organization.longitude !== null;

    return {
      organization: toPublicOrganization(
        { ...organization, expertise },
        { memberCount, includeContact: true },
      ),
      membership: {
        id: membership.id,
        membershipRole: membership.membershipRole,
        joinedAt: membership.joinedAt?.toISOString() ?? null,
      },
      permissions: OrganizationAccessService.workspacePermissions(membership),
      coordinates: hasCoordinates
        ? {
            latitude: Number(organization.latitude),
            longitude: Number(organization.longitude),
          }
        : null,
    };
  }

  /**
   * The dashboard, in one response.
   *
   * Every figure is a count over real rows. Where something cannot be
   * measured yet — problems an organisation has *resolved* needs allocation,
   * a later milestone — it is simply not on the dashboard, rather than shown
   * as a zero that reads like a measurement.
   */
  async dashboard(
    context: WorkspaceContext,
    userId: string,
  ): Promise<OrganizationDashboard> {
    const { organization, membership } = context;
    const manages = OrganizationAccessService.MANAGING_ROLES.includes(
      membership.membershipRole,
    );

    const [
      viewer,
      opportunities,
      newOpportunities,
      opportunitiesByCategory,
      relevant,
      recent,
      supported,
      suggestionCounts,
      roleCounts,
      pendingInvitations,
      recentMembers,
      expertiseCount,
      recommended,
      allocationCounts,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { fullName: true, displayName: true },
      }),
      this.problems.count(organization, { scope: 'relevant' }),
      this.problems.count(organization, {
        scope: 'relevant',
        reportedWithinDays: NEW_OPPORTUNITY_DAYS,
      }),
      this.problems.countByCategory(organization),
      this.problems.list(
        organization,
        userId,
        { scope: 'relevant', sort: 'relevance' },
        1,
        4,
      ),
      this.problems.list(
        organization,
        userId,
        { scope: 'all', sort: 'recent', serviceAreaOnly: true },
        1,
        4,
      ),
      // Distinct problems supported by anyone currently on the team. A count
      // over the votes table joined to active memberships — one query.
      this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT count(DISTINCT v."problemId")::int AS count
        FROM problem_votes v
        JOIN organization_members m ON m."userId" = v."userId"
        JOIN problems p ON p."id" = v."problemId"
        WHERE m."organizationId" = ${organization.id}::uuid
          AND m."status" = 'ACTIVE'
          AND p."deletedAt" IS NULL
      `),
      this.prisma.$transaction([
        this.prisma.problemSuggestion.count({
          where: { organizationId: organization.id, deletedAt: null },
        }),
        this.prisma.problemSuggestion.count({
          where: { organizationId: organization.id, status: 'ACCEPTED', deletedAt: null },
        }),
      ]),
      this.prisma.organizationMember.groupBy({
        by: ['membershipRole'],
        where: { organizationId: organization.id, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      manages
        ? this.prisma.organizationMember.count({
            where: { organizationId: organization.id, status: 'INVITED' },
          })
        : Promise.resolve(null),
      this.prisma.organizationMember.findMany({
        where: { organizationId: organization.id, status: 'ACTIVE' },
        include: { user: true },
        orderBy: [{ joinedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: 5,
      }),
      this.prisma.organizationExpertise.count({
        where: { organizationId: organization.id },
      }),
      this.problems.listRecommended(
        organization,
        userId,
        { sort: 'relevance', view: 'active' },
        1,
        4,
      ),
      this.allocations.organizationMetrics(organization.id),
    ]);

    const byRole: Record<OrganizationMemberRole, number> = {
      OWNER: 0,
      ADMIN: 0,
      MEMBER: 0,
    };
    for (const group of roleCounts) byRole[group.membershipRole] = group._count._all;
    const teamTotal = byRole.OWNER + byRole.ADMIN + byRole.MEMBER;

    // The same rule as the citizen dashboard, so a person is greeted by one
    // name across both workspaces.
    const name = viewer.displayName ?? viewer.fullName;

    return {
      viewer: {
        firstName: name.split(' ')[0] ?? name,
        membershipRole: membership.membershipRole,
      },
      metrics: {
        opportunities,
        newOpportunities,
        problemsSupportedByTeam: supported[0]?.count ?? 0,
        suggestionsMade: suggestionCounts[0],
        suggestionsAccepted: suggestionCounts[1],
        teamMembers: teamTotal,
        pendingInvitations,
        ...allocationCounts,
      },
      opportunitiesByCategory,
      relevantProblems: relevant.items,
      recommendations: { total: recommended.totalCount, items: recommended.items },
      recentProblems: recent.items,
      teamSummary: {
        total: teamTotal,
        byRole,
        recentMembers: recentMembers.map(toMemberSummary),
      },
      setup: {
        hasExpertise: expertiseCount > 0,
        hasLocation:
          (organization.latitude !== null && organization.longitude !== null) ||
          organization.city !== null,
      },
    };
  }

  /**
   * Hides (or restores) a recommendation for this organisation.
   *
   * The only thing an organisation can do to a match: say it is not relevant
   * to them. It never touches the score, and it is not an acceptance or a
   * refusal of work — those workflows do not exist yet. Survives re-matching.
   */
  async setRecommendationDismissed(
    { organization }: WorkspaceContext,
    publicId: string,
    dismissed: boolean,
    actorUserId: string,
  ): Promise<void> {
    const problem = await this.prisma.problem.findFirst({
      where: { publicId, deletedAt: null },
      select: { id: true },
    });
    if (!problem) throw AppException.notFound('Recommendation');

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.organizationProblemMatch.updateMany({
        where: {
          problemId: problem.id,
          organizationId: organization.id,
          status: dismissed ? { in: ['CALCULATED', 'STALE'] } : 'DISMISSED',
        },
        // A restored match is shown again; the next re-match refreshes it.
        data: { status: dismissed ? 'DISMISSED' : 'STALE' },
      });
      if (count === 0) throw AppException.notFound('Recommendation');

      await recordOrganizationAudit(tx, {
        actorUserId,
        action: dismissed
          ? 'ORGANIZATION_RECOMMENDATION_DISMISSED'
          : 'ORGANIZATION_RECOMMENDATION_RESTORED',
        organizationId: organization.id,
        metadata: { problemPublicId: publicId },
      });
    });
  }
}
