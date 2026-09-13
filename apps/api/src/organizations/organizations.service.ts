import { Injectable } from '@nestjs/common';
import type {
  OrganizationActivity,
  OrganizationExpertiseEntry,
  OrganizationMemberSummary,
  PublicOrganization,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  CreateExpertiseDto,
  UpdateOrganizationDto,
} from './dto/organization.dto.js';
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

    await this.prisma.organization.update({ where: { id: organizationId }, data });

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
   * belongs to *this* organisation (not another one whose id was guessed); and
   * demoting the last owner is refused.
   */
  async updateMemberRole(
    organizationId: string,
    memberId: string,
    membershipRole: 'OWNER' | 'ADMIN' | 'MEMBER',
    user: RequestUser,
  ): Promise<OrganizationMemberSummary> {
    await this.access.assertCanManage(organizationId, user);

    const membership = await this.prisma.organizationMember.findFirst({
      // Scoped by organisation as well as id: without this, a manager of one
      // organisation could edit a membership belonging to another.
      where: { id: memberId, organizationId },
    });
    if (!membership) throw AppException.notFound('Member');

    if (membership.membershipRole === 'OWNER' && membershipRole !== 'OWNER') {
      await this.access.assertNotLastOwner(organizationId, membership);
    }

    const updated = await this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { membershipRole },
      include: { user: true },
    });

    return toMemberSummary(updated);
  }

  /** Removes a member. The last owner cannot be removed. */
  async removeMember(
    organizationId: string,
    memberId: string,
    user: RequestUser,
  ): Promise<void> {
    await this.access.assertCanManage(organizationId, user);

    const membership = await this.prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!membership) throw AppException.notFound('Member');

    await this.access.assertNotLastOwner(organizationId, membership);

    // Marked LEFT rather than deleted: membership history is part of the
    // organisation's record, and a deleted row cannot answer "who was on the
    // team when this problem was allocated?".
    await this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { status: 'LEFT' },
    });
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
  }
}
