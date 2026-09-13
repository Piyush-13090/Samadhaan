import { Injectable } from '@nestjs/common';
import type { OrganizationPermissions } from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  OrganizationMember,
  OrganizationMemberRole,
} from '../generated/prisma/client.js';

/**
 * Decides what a user may do with an organisation.
 *
 * Every organisation mutation goes through here. Centralising it means the
 * rules are stated once and can be read in one place, rather than being
 * re-derived — and eventually mis-derived — in each handler.
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
 * and a platform admin is not automatically a member of anything.
 */
@Injectable()
export class OrganizationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Roles that may change an organisation's identity and manage its people. */
  private static readonly MANAGING_ROLES: OrganizationMemberRole[] = ['OWNER', 'ADMIN'];

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

    const membership = await this.findMembership(organizationId, user.id);
    if (!membership) return none;

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
   * Requires OWNER/ADMIN membership, or platform ADMIN.
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
   * Guards the last-owner invariant.
   *
   * An organisation with no OWNER has nobody who can add one back, so it
   * becomes permanently unmanageable. This is checked before any demotion or
   * removal of an owner, including by a platform ADMIN — the invariant protects
   * the organisation, not the actor.
   */
  async assertNotLastOwner(
    organizationId: string,
    membership: OrganizationMember,
  ): Promise<void> {
    if (membership.membershipRole !== 'OWNER') return;

    const owners = await this.prisma.organizationMember.count({
      where: { organizationId, membershipRole: 'OWNER', status: 'ACTIVE' },
    });

    if (owners <= 1) {
      throw AppException.conflict(
        'This is the only owner. Make someone else an owner first.',
      );
    }
  }
}
