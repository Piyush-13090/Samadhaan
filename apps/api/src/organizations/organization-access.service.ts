import { Injectable } from '@nestjs/common';
import {
  isWorkspaceOrganizationType,
  type OrganizationPermissions,
  type WorkspacePermissions,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  Prisma,
  type Organization,
  type OrganizationMember,
  type OrganizationMemberRole,
} from '../generated/prisma/client.js';

/** A Prisma client or an open transaction — the owner check runs in either. */
type Db = Prisma.TransactionClient;

/** An organisation and the caller's membership in it, once both are proven. */
export interface WorkspaceContext {
  organization: Organization;
  membership: OrganizationMember;
}

/**
 * Decides what a user may do with an organisation.
 *
 * Every organisation mutation and every workspace read goes through here.
 * Centralising it means the rules are stated once and can be read in one
 * place, rather than being re-derived — and eventually mis-derived — in each
 * handler.
 *
 * Two layers of authority are combined:
 *
 *   - **Platform role** (`UserRole`) — an ADMIN may act on any organisation.
 *   - **Membership role** (`OrganizationMemberRole`) — OWNER and ADMIN may
 *     edit their own organisation; MEMBER may not.
 *
 * They are separate because they answer different questions: the platform role
 * says what someone may do on Samadhaan, the membership role what they may do
 * inside one organisation. A citizen who owns an NGO is not a platform admin,
 * and a platform admin is not automatically a member of anything — which is
 * why the *workspace* requires membership even of a platform admin.
 */
@Injectable()
export class OrganizationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Roles that may change an organisation's identity and manage its people. */
  static readonly MANAGING_ROLES: readonly OrganizationMemberRole[] = ['OWNER', 'ADMIN'];

  /**
   * Whether an organisation is open for business. A suspended or deactivated
   * organisation keeps its record and its public profile, but its members can
   * no longer work in it or change it.
   */
  static isOperational(
    organization: Pick<Organization, 'isActive' | 'verificationStatus' | 'deletedAt'>,
  ): boolean {
    return (
      organization.deletedAt === null &&
      organization.isActive &&
      organization.verificationStatus !== 'SUSPENDED'
    );
  }

  /** The caller's active membership, or `null`. */
  async findMembership(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember | null> {
    return this.prisma.organizationMember.findFirst({
      where: { organizationId, userId, status: 'ACTIVE' },
    });
  }

  /**
   * Resolves a workspace from its URL slug for the signed-in user.
   *
   * The chain, in order, every step server-side:
   *
   *   authenticated → organisation exists → it is a workspace type →
   *   the user holds an ACTIVE membership → the organisation is operational
   *
   * Everything up to membership answers **404**, so a non-member cannot use
   * the workspace endpoints to learn which slugs exist or which organisations
   * are suspended. Only a proven member is told the organisation is suspended
   * (403) — they are entitled to know why their workspace is closed.
   */
  async resolveWorkspace(slug: string, user: RequestUser): Promise<WorkspaceContext> {
    const organization = await this.prisma.organization.findFirst({
      where: { slug: slug.toLowerCase(), deletedAt: null },
    });

    if (!organization || !isWorkspaceOrganizationType(organization.type)) {
      throw AppException.notFound('Organisation');
    }

    const membership = await this.findMembership(organization.id, user.id);
    if (!membership) throw AppException.notFound('Organisation');

    if (!OrganizationAccessService.isOperational(organization)) {
      throw AppException.forbidden(
        'This organisation is suspended. Its workspace is closed until Samadhaan restores it.',
      );
    }

    return { organization, membership };
  }

  /** What a proven member may do in their workspace. */
  static workspacePermissions(membership: OrganizationMember): WorkspacePermissions {
    const role = membership.membershipRole;
    const manages = OrganizationAccessService.MANAGING_ROLES.includes(role);

    return {
      canEditProfile: manages,
      canManageExpertise: manages,
      canManageMembers: manages,
      // An ADMIN runs the team but cannot mint owners; only an owner can share
      // ownership. See `assertCanChangeMember`.
      assignableRoles:
        role === 'OWNER'
          ? ['OWNER', 'ADMIN', 'MEMBER']
          : manages
            ? ['ADMIN', 'MEMBER']
            : [],
    };
  }

  /**
   * What `user` may do with `organizationId`.
   *
   * Returned to the client so the UI can hide unusable controls. It is a
   * mirror of this decision, never the decision itself — every mutating
   * endpoint calls `assert*` again server-side.
   */
  async permissionsFor(
    organizationId: string,
    user: RequestUser | null,
  ): Promise<OrganizationPermissions> {
    const none: OrganizationPermissions = {
      canEdit: false,
      canManageMembers: false,
      canManageExpertise: false,
      canVerify: false,
    };

    if (!user) return none;

    if (user.role === 'ADMIN') {
      return {
        canEdit: true,
        canManageMembers: true,
        canManageExpertise: true,
        // Verification is an administrative capability, but it is not part of
        // this milestone — no endpoint honours it yet.
        canVerify: false,
      };
    }

    const [membership, organization] = await Promise.all([
      this.findMembership(organizationId, user.id),
      this.prisma.organization.findFirst({
        where: { id: organizationId },
        select: { isActive: true, verificationStatus: true, deletedAt: true },
      }),
    ]);
    if (!membership || !organization) return none;

    // A suspended organisation is frozen for its own members. Only a platform
    // admin, above, can still act on it.
    if (!OrganizationAccessService.isOperational(organization)) return none;

    const manages = OrganizationAccessService.MANAGING_ROLES.includes(
      membership.membershipRole,
    );

    return {
      canEdit: manages,
      canManageMembers: manages,
      canManageExpertise: manages,
      canVerify: false,
    };
  }

  /**
   * Requires OWNER/ADMIN membership of an operational organisation, or
   * platform ADMIN.
   *
   * Throws 403 for both "not a member" and "a member without authority". The
   * two are deliberately indistinguishable: telling a stranger that an
   * organisation exists but they lack the role confirms its existence and maps
   * the privileged surface for them.
   */
  async assertCanManage(organizationId: string, user: RequestUser): Promise<void> {
    const permissions = await this.permissionsFor(organizationId, user);

    if (!permissions.canEdit) {
      throw AppException.forbidden('You do not have access to this organisation');
    }
  }

  /**
   * Whether `actor` may change `target`'s membership — its role, or remove it.
   *
   * `assertCanManage` must already have passed. On top of it:
   *
   *  - **Nobody changes their own membership here.** Self-promotion is the
   *    obvious attack, and self-demotion or self-removal by accident is how an
   *    organisation loses its only manager. Leaving is a separate decision.
   *  - **An ADMIN cannot touch an OWNER, nor create one.** Otherwise an admin
   *    could promote a friend to owner and have them demote the real owners.
   *  - **The last OWNER is never demoted or removed** — by anyone, including a
   *    platform admin. See `assertNotLastOwner`.
   *
   * A platform ADMIN who is not a member is treated as an owner.
   */
  async assertCanChangeMember(
    organizationId: string,
    actor: RequestUser,
    target: OrganizationMember,
    newRole: OrganizationMemberRole | null,
    db: Db = this.prisma,
  ): Promise<void> {
    if (target.userId === actor.id) {
      throw AppException.forbidden(
        'You cannot change your own membership. Ask another owner or admin.',
      );
    }

    const actorMembership = await this.findMembership(organizationId, actor.id);
    const actorRole: OrganizationMemberRole | null =
      actorMembership?.membershipRole ?? (actor.role === 'ADMIN' ? 'OWNER' : null);

    if (actorRole === null || actorRole === 'MEMBER') {
      throw AppException.forbidden('You do not have access to this organisation');
    }

    if (actorRole === 'ADMIN') {
      if (target.membershipRole === 'OWNER') {
        throw AppException.forbidden('Only an owner can change another owner.');
      }
      if (newRole === 'OWNER') {
        throw AppException.forbidden('Only an owner can make someone an owner.');
      }
    }

    const demotesOrRemovesOwner =
      target.membershipRole === 'OWNER' && newRole !== 'OWNER';
    if (demotesOrRemovesOwner) {
      await this.assertNotLastOwner(organizationId, target, db);
    }
  }

  /**
   * Guards the last-owner invariant.
   *
   * An organisation with no OWNER has nobody who can add one back, so it
   * becomes permanently unmanageable. This is checked before any demotion or
   * removal of an owner, including by a platform ADMIN — the invariant protects
   * the organisation, not the actor.
   *
   * Pass the write's transaction as `db`: the owner rows are then locked
   * `FOR UPDATE` until it commits, so two owners demoting each other at the
   * same moment cannot both see "two owners" and leave none.
   */
  async assertNotLastOwner(
    organizationId: string,
    membership: OrganizationMember,
    db: Db = this.prisma,
  ): Promise<void> {
    if (membership.membershipRole !== 'OWNER') return;

    const owners = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM organization_members
      WHERE "organizationId" = ${organizationId}::uuid
        AND "membershipRole" = 'OWNER'
        AND "status" = 'ACTIVE'
      FOR UPDATE
    `);

    if (owners.length <= 1) {
      throw AppException.conflict(
        'This is the only owner. Make someone else an owner first.',
      );
    }
  }
}
