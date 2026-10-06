import { Injectable } from '@nestjs/common';
import type { GovernmentWorkspaceSummary, JurisdictionType } from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Organization, OrganizationMember } from '../generated/prisma/client.js';
import { OrganizationAccessService } from '../organizations/organization-access.service.js';
import { resolveJurisdiction, type ResolvedJurisdiction } from './jurisdiction.js';

/** A government office, the caller's membership in it, and its jurisdiction. */
export interface GovernmentScope {
  organization: Organization;
  membership: OrganizationMember;
  jurisdiction: ResolvedJurisdiction;
}

/**
 * Who may use the government portal, for which office.
 *
 * Three conditions, all from the database:
 *
 *   platform role GOVERNMENT  (checked by `@Roles` before this runs)
 *   → ACTIVE membership of a GOVERNMENT organisation, by slug
 *   → that organisation is operational (not suspended or deactivated)
 *
 * A platform ADMIN is not a government official and is not let in: the portal
 * is scoped to an office's jurisdiction, and an administrator belongs to none.
 * Everything up to membership answers 404, so the portal cannot be used to
 * discover which offices exist.
 */
@Injectable()
export class GovernmentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(slug: string, user: RequestUser): Promise<GovernmentScope> {
    if (user.role !== 'GOVERNMENT') {
      throw AppException.forbidden('The government portal is for government officials.');
    }

    const organization = await this.prisma.organization.findFirst({
      where: { slug: slug.toLowerCase(), deletedAt: null, type: 'GOVERNMENT' },
    });
    if (!organization) throw AppException.notFound('Government office');

    const membership = await this.prisma.organizationMember.findFirst({
      where: { organizationId: organization.id, userId: user.id, status: 'ACTIVE' },
    });
    if (!membership) throw AppException.notFound('Government office');

    if (!OrganizationAccessService.isOperational(organization)) {
      throw AppException.forbidden(
        'This office is suspended on Samadhaan. Its portal is closed until it is restored.',
      );
    }

    return {
      organization,
      membership,
      jurisdiction: await resolveJurisdiction(this.prisma, organization.id),
    };
  }

  /** The government offices the caller belongs to. */
  async mine(user: RequestUser): Promise<GovernmentWorkspaceSummary[]> {
    if (user.role !== 'GOVERNMENT') return [];

    const memberships = await this.prisma.organizationMember.findMany({
      where: {
        userId: user.id,
        status: 'ACTIVE',
        organization: { type: 'GOVERNMENT', deletedAt: null },
      },
      include: { organization: true },
      orderBy: { organization: { name: 'asc' } },
    });

    return memberships.map(({ organization, membershipRole }) => ({
      organizationId: organization.id,
      slug: organization.slug,
      name: organization.name,
      jurisdictionType: organization.jurisdictionType as JurisdictionType | null,
      jurisdictionName: organization.jurisdictionName,
      membershipRole,
      isAccessible: OrganizationAccessService.isOperational(organization),
    }));
  }
}
