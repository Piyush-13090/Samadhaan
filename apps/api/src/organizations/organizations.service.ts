import { Injectable } from '@nestjs/common';
import {
  isWorkspaceOrganizationType,
  type InvitableMemberRole,
  type MyOrganizations,
  type OrganizationActivity,
  type OrganizationExpertiseEntry,
  type OrganizationMemberSummary,
  type PublicOrganization,
  type WorkspaceOrganizationType,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import type { OrganizationMemberRole, Prisma } from '../generated/prisma/client.js';
import type {
  CreateExpertiseDto,
  UpdateOrganizationDto,
} from './dto/organization.dto.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import { recordOrganizationAudit } from './organization-audit.js';
import { OrganizationAccessService } from './organization-access.service.js';
import {
  toExpertiseEntry,
  toMemberSummary,
  toOrganizationActivity,
  toPublicOrganization,
} from './organization.serializer.js';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly events: DomainEventBus,
  ) {}

  /**
   * Loaded for every profile read. Expertise is ordered by level so the
   * strongest capabilities lead — the same order the matcher will care about.
   */
  private static readonly profileInclude = {
    expertise: {
      orderBy: [{ level: 'desc' as const }, { category: 'asc' as const }],
    },
  } satisfies Prisma.OrganizationInclude;

  /**
   * Public profile by slug.
   *
   * `viewer` is optional: a signed-out visitor gets the profile without the
   * permissions block, which is what tells the UI to render it read-only.
   */
  async findBySlug(
    slug: string,
    viewer: RequestUser | null,
  ): Promise<PublicOrganization> {
    const organization = await this.prisma.organization.findFirst({
      where: { slug: slug.toLowerCase(), deletedAt: null },
      include: OrganizationsService.profileInclude,
    });

    if (!organization) throw AppException.notFound('Organisation');

    const [memberCount, permissions] = await Promise.all([
      this.prisma.organizationMember.count({
        where: { organizationId: organization.id, status: 'ACTIVE' },
      }),
      this.access.permissionsFor(organization.id, viewer),
    ]);

    return toPublicOrganization(organization, {
      memberCount,
      permissions: viewer ? permissions : undefined,
    });
  }

  /** Civic contribution counts. Batched so a profile costs one round trip. */
  async getActivity(organizationId: string): Promise<OrganizationActivity> {
    const [suggestionsMade, suggestionsAccepted] = await this.prisma.$transaction([
      this.prisma.problemSuggestion.count({
        where: { organizationId, deletedAt: null },
      }),
      this.prisma.problemSuggestion.count({
        where: { organizationId, status: 'ACCEPTED', deletedAt: null },
      }),
    ]);

    return toOrganizationActivity({ suggestionsMade, suggestionsAccepted });
  }

  /**
   * Updates an organisation's profile.
   *
   * Authorisation runs before anything is read or written. Note the id comes
   * from the path: that is exactly why `assertCanManage` is not optional — it
   * is what stops a member of organisation A editing organisation B by
   * changing the id in the URL.
   */
  async update(
    organizationId: string,
    dto: UpdateOrganizationDto,
    user: RequestUser,
  ): Promise<PublicOrganization> {
    await this.access.assertCanManage(organizationId, user);

    const existing = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
    });
    if (!existing) throw AppException.notFound('Organisation');

    // Built key by key so an absent field is left alone and an explicit null
    // clears it — the two must stay distinguishable.
    const data: Record<string, unknown> = {};
    for (const key of [
      'name',
      'description',
      'logoUrl',
      'websiteUrl',
      'email',
      'phone',
      'address',
      'city',
      'state',
      'country',
      'postalCode',
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }

    // Coordinates move as a pair, checked here because two stacked
    // `@ValidateIf`s cannot express "both null or both numbers". The PostGIS
    // column is derived from them by the `organizations_location_sync` trigger.
    if (dto.latitude !== undefined || dto.longitude !== undefined) {
      const latitudeCleared = (dto.latitude ?? null) === null;
      const longitudeCleared = (dto.longitude ?? null) === null;
      if (latitudeCleared !== longitudeCleared) {
        throw AppException.badRequest(
          'Latitude and longitude are set or cleared together.',
        );
      }
      data.latitude = dto.latitude ?? null;
      data.longitude = dto.longitude ?? null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: organizationId }, data });
      await recordOrganizationAudit(tx, {
        actorUserId: user.id,
        action: 'ORGANIZATION_PROFILE_UPDATED',
        organizationId,
        // Field names only: the values may include contact details, and an
        // audit trail is not the place to keep a second copy of them.
        metadata: { fields: Object.keys(data) },
      });
    });

    // Matching reads the profile wording and the location; tell it.
    const changes: Array<'profile' | 'location'> = [];
    if (['name', 'description'].some((key) => key in data)) changes.push('profile');
    if (['city', 'state', 'latitude', 'longitude'].some((key) => key in data)) {
      changes.push('location');
    }
    if (changes.length > 0) {
      this.events.publish({
        type: 'ORGANIZATION_PROFILE_CHANGED',
        organizationId,
        changes,
      });
    }

    // Renaming deliberately does not change the slug — see slug.util.ts.
    return this.findBySlug(existing.slug, user);
  }

  /** The team roster. Public identity only. */
  async listMembers(
    organizationId: string,
    viewer: RequestUser | null,
  ): Promise<OrganizationMemberSummary[]> {
    const exists = await this.prisma.organization.count({
      where: { id: organizationId, deletedAt: null },
    });
    if (exists === 0) throw AppException.notFound('Organisation');

    const permissions = await this.access.permissionsFor(organizationId, viewer);

    const members = await this.prisma.organizationMember.findMany({
      where: {
        organizationId,
        // Pending invitations are visible only to managers. Publishing them
        // would let anyone imply an affiliation by inviting someone who never
        // replied.
        status: permissions.canManageMembers ? { not: 'LEFT' } : 'ACTIVE',
      },
      include: { user: true },
      orderBy: [{ membershipRole: 'asc' }, { joinedAt: 'asc' }],
    });

    return members.map(toMemberSummary);
  }

  /**
   * Changes a member's role.
   *
   * Guards, in order: the caller manages this organisation; the membership
   * belongs to *this* organisation (not another one whose id was guessed); the
   * role hierarchy allows it (`assertCanChangeMember`); and the last owner is
   * never demoted. The owner check and the write share a transaction, so the
   * invariant survives two concurrent demotions.
   */
  async updateMemberRole(
    organizationId: string,
    memberId: string,
    membershipRole: OrganizationMemberRole,
    user: RequestUser,
  ): Promise<OrganizationMemberSummary> {
    await this.access.assertCanManage(organizationId, user);

    const updated = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.organizationMember.findFirst({
        // Scoped by organisation as well as id: without this, a manager of one
        // organisation could edit a membership belonging to another.
        where: { id: memberId, organizationId, status: { not: 'LEFT' } },
      });
      if (!membership) throw AppException.notFound('Member');

      await this.access.assertCanChangeMember(
        organizationId,
        user,
        membership,
        membershipRole,
        tx,
      );

      if (membership.membershipRole === membershipRole) {
        return tx.organizationMember.findUniqueOrThrow({
          where: { id: memberId },
          include: { user: true },
        });
      }

      const result = await tx.organizationMember.update({
        where: { id: memberId },
        data: { membershipRole },
        include: { user: true },
      });

      await recordOrganizationAudit(tx, {
        actorUserId: user.id,
        action: 'ORGANIZATION_MEMBER_ROLE_CHANGED',
        organizationId,
        metadata: {
          membershipId: memberId,
          userId: membership.userId,
          from: membership.membershipRole,
          to: membershipRole,
        },
      });

      return result;
    });

    return toMemberSummary(updated);
  }

  /**
   * Removes a member, or withdraws an invitation. The same hierarchy as a role
   * change applies, and the last owner cannot be removed.
   */
  async removeMember(
    organizationId: string,
    memberId: string,
    user: RequestUser,
  ): Promise<void> {
    await this.access.assertCanManage(organizationId, user);

    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.organizationMember.findFirst({
        where: { id: memberId, organizationId, status: { not: 'LEFT' } },
      });
      if (!membership) throw AppException.notFound('Member');

      await this.access.assertCanChangeMember(organizationId, user, membership, null, tx);

      // Marked LEFT rather than deleted: membership history is part of the
      // organisation's record, and a deleted row cannot answer "who was on the
      // team when this problem was allocated?".
      await tx.organizationMember.update({
        where: { id: memberId },
        data: { status: 'LEFT' },
      });

      await recordOrganizationAudit(tx, {
        actorUserId: user.id,
        action:
          membership.status === 'INVITED'
            ? 'ORGANIZATION_INVITATION_WITHDRAWN'
            : 'ORGANIZATION_MEMBER_REMOVED',
        organizationId,
        metadata: {
          membershipId: memberId,
          userId: membership.userId,
          role: membership.membershipRole,
        },
      });
    });
  }

  // --- Invitations --------------------------------------------------------

  /**
   * Invites an existing Samadhaan account to the organisation.
   *
   * The invitation is an INVITED membership row — the schema already models
   * it, and the unique `(organizationId, userId)` constraint means a second
   * invitation cannot race the first into a duplicate. The invitee sees it in
   * their workspace list and accepts or declines there.
   *
   * Inviting by email does reveal to a manager whether that email has an
   * account. That is accepted for a manager-only, rate-limited action, and is
   * the price of telling them something useful ("ask them to register")
   * instead of pretending an invitation went to nobody.
   */
  async invite(
    organizationId: string,
    input: { email: string; membershipRole: InvitableMemberRole },
    user: RequestUser,
  ): Promise<OrganizationMemberSummary> {
    await this.access.assertCanManage(organizationId, user);

    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { type: true },
    });
    if (!organization) throw AppException.notFound('Organisation');

    const invitee = await this.prisma.user.findFirst({
      where: { email: input.email, deletedAt: null, status: 'ACTIVE' },
    });
    if (!invitee) {
      throw AppException.notFoundMessage(
        'No active Samadhaan account uses that email address. Ask them to register first.',
      );
    }

    const membership = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: invitee.id } },
      });

      if (existing && existing.status === 'ACTIVE') {
        throw AppException.conflict('That person is already a member.');
      }
      if (existing && existing.status === 'INVITED') {
        throw AppException.conflict('That person already has a pending invitation.');
      }
      if (existing && existing.status === 'SUSPENDED') {
        throw AppException.conflict(
          'That membership is suspended. It cannot be re-invited from here.',
        );
      }

      // A former member is re-invited on their old row: history is kept, and
      // the unique constraint would refuse a second one anyway.
      const row = existing
        ? await tx.organizationMember.update({
            where: { id: existing.id },
            data: {
              status: 'INVITED',
              membershipRole: input.membershipRole,
              joinedAt: null,
            },
            include: { user: true },
          })
        : await tx.organizationMember.create({
            data: {
              organizationId,
              userId: invitee.id,
              membershipRole: input.membershipRole,
              status: 'INVITED',
            },
            include: { user: true },
          });

      await recordOrganizationAudit(tx, {
        actorUserId: user.id,
        action: 'ORGANIZATION_MEMBER_INVITED',
        organizationId,
        // The invitee's id, not their email: the email is personal data and
        // the id is enough to reconstruct who was invited.
        metadata: {
          membershipId: row.id,
          userId: invitee.id,
          role: input.membershipRole,
        },
      });

      return row;
    });

    return toMemberSummary(membership);
  }

  /**
   * Accepts or declines an invitation addressed to the caller.
   *
   * The membership is looked up by id **and** the caller's user id, so one
   * person cannot answer another's invitation by guessing its id — a wrong id
   * and someone else's id are the same 404.
   */
  async respondToInvitation(
    membershipId: string,
    accept: boolean,
    user: RequestUser,
  ): Promise<void> {
    const invitation = await this.prisma.organizationMember.findFirst({
      where: { id: membershipId, userId: user.id, status: 'INVITED' },
      include: { organization: true },
    });
    if (!invitation || invitation.organization.deletedAt !== null) {
      throw AppException.notFound('Invitation');
    }

    if (accept && !OrganizationAccessService.isOperational(invitation.organization)) {
      throw AppException.forbidden(
        'This organisation is suspended, so its invitations cannot be accepted right now.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Conditional on still being INVITED, so a withdrawal that lands first
      // is not overwritten by a stale acceptance.
      const { count } = await tx.organizationMember.updateMany({
        where: { id: membershipId, userId: user.id, status: 'INVITED' },
        data: accept
          ? { status: 'ACTIVE', joinedAt: new Date() }
          : { status: 'LEFT', joinedAt: null },
      });
      if (count === 0) throw AppException.notFound('Invitation');

      await recordOrganizationAudit(tx, {
        actorUserId: user.id,
        action: accept
          ? 'ORGANIZATION_INVITATION_ACCEPTED'
          : 'ORGANIZATION_INVITATION_DECLINED',
        organizationId: invitation.organizationId,
        metadata: { membershipId },
      });
    });
  }

  /**
   * The caller's workspaces and pending invitations.
   *
   * Only NGO, university and industry organisations — a government office is
   * an organisation in the data model but works in the government workspace.
   * Suspended organisations are still listed, marked inaccessible, so a member
   * sees why rather than finding the workspace gone.
   */
  async mine(user: RequestUser): Promise<MyOrganizations> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: {
        userId: user.id,
        status: { in: ['ACTIVE', 'INVITED'] },
        organization: { deletedAt: null },
      },
      select: {
        id: true,
        status: true,
        membershipRole: true,
        createdAt: true,
        updatedAt: true,
        organization: {
          select: {
            id: true,
            slug: true,
            name: true,
            type: true,
            logoUrl: true,
            verificationStatus: true,
            isActive: true,
            deletedAt: true,
          },
        },
      },
      orderBy: [{ organization: { name: 'asc' } }],
    });

    const result: MyOrganizations = { workspaces: [], invitations: [] };

    for (const membership of memberships) {
      const org = membership.organization;
      if (!isWorkspaceOrganizationType(org.type)) continue;
      const type: WorkspaceOrganizationType = org.type;

      if (membership.status === 'ACTIVE') {
        result.workspaces.push({
          organizationId: org.id,
          slug: org.slug,
          name: org.name,
          type,
          logoUrl: org.logoUrl,
          verificationStatus: org.verificationStatus,
          membershipRole: membership.membershipRole,
          isAccessible: OrganizationAccessService.isOperational(org),
        });
      } else {
        result.invitations.push({
          membershipId: membership.id,
          membershipRole: membership.membershipRole,
          // A re-invitation reuses an old row, so the last change is when this
          // invitation was sent.
          invitedAt: membership.updatedAt.toISOString(),
          organization: {
            slug: org.slug,
            name: org.name,
            type,
            logoUrl: org.logoUrl,
            verificationStatus: org.verificationStatus,
          },
        });
      }
    }

    return result;
  }

  // --- Expertise ---------------------------------------------------------

  async listExpertise(organizationId: string): Promise<OrganizationExpertiseEntry[]> {
    const entries = await this.prisma.organizationExpertise.findMany({
      where: { organizationId },
      orderBy: [{ level: 'desc' }, { category: 'asc' }],
    });

    return entries.map(toExpertiseEntry);
  }

  /**
   * Declares an area of work.
   *
   * Upserts on `(organizationId, category)`: re-declaring an existing category
   * updates its level rather than failing, which is what a user pressing "add"
   * on something already listed actually means.
   */
  async addExpertise(
    organizationId: string,
    dto: CreateExpertiseDto,
    user: RequestUser,
  ): Promise<OrganizationExpertiseEntry> {
    await this.access.assertCanManage(organizationId, user);

    const entry = await this.prisma.organizationExpertise.upsert({
      where: {
        organizationId_category: { organizationId, category: dto.category },
      },
      update: {
        subcategory: dto.subcategory ?? null,
        level: dto.level ?? 'EXPERIENCED',
      },
      create: {
        organizationId,
        category: dto.category,
        subcategory: dto.subcategory ?? null,
        level: dto.level ?? 'EXPERIENCED',
        addedById: user.id,
      },
    });

    await recordOrganizationAudit(this.prisma, {
      actorUserId: user.id,
      action: 'ORGANIZATION_EXPERTISE_SET',
      organizationId,
      metadata: { category: entry.category, level: entry.level },
    });
    this.events.publish({
      type: 'ORGANIZATION_PROFILE_CHANGED',
      organizationId,
      changes: ['expertise'],
    });

    return toExpertiseEntry(entry);
  }

  async removeExpertise(
    organizationId: string,
    expertiseId: string,
    user: RequestUser,
  ): Promise<void> {
    await this.access.assertCanManage(organizationId, user);

    // Scoped by organisation, so an id from another organisation cannot be
    // deleted by guessing it.
    const deleted = await this.prisma.organizationExpertise.deleteMany({
      where: { id: expertiseId, organizationId },
    });

    if (deleted.count === 0) throw AppException.notFound('Expertise');

    await recordOrganizationAudit(this.prisma, {
      actorUserId: user.id,
      action: 'ORGANIZATION_EXPERTISE_REMOVED',
      organizationId,
      metadata: { expertiseId },
    });
    this.events.publish({
      type: 'ORGANIZATION_PROFILE_CHANGED',
      organizationId,
      changes: ['expertise'],
    });
  }
}
