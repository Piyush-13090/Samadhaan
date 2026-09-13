import type {
  OrganizationActivity,
  OrganizationExpertiseEntry,
  OrganizationMemberSummary,
  OrganizationPermissions,
  PublicOrganization,
} from '@samadhaan/shared';
import type {
  Organization,
  OrganizationExpertise,
  OrganizationMember,
  User,
} from '../generated/prisma/client.js';

/**
 * Response shapes for organisations.
 *
 * As with users, these are explicit allow-lists. `Organization` currently has
 * no secret columns, but that is a property of today's schema, not a guarantee
 * — an allow-list means a column added later is invisible until someone
 * deliberately publishes it.
 */

export type OrganizationWithRelations = Organization & {
  expertise: OrganizationExpertise[];
  _count?: { members: number };
};

export function toExpertiseEntry(
  expertise: OrganizationExpertise,
): OrganizationExpertiseEntry {
  return {
    id: expertise.id,
    category: expertise.category,
    subcategory: expertise.subcategory,
    level: expertise.level,
    createdAt: expertise.createdAt.toISOString(),
  };
}

/**
 * The public view of an organisation.
 *
 * **Contact details are withheld unless the organisation is VERIFIED.** An
 * unverified profile is an unchecked claim; publishing an email and phone
 * against one turns the platform into a convenient vector for impersonating a
 * civic body. Members and platform admins still see them through the edit form,
 * which is gated separately.
 */
export function toPublicOrganization(
  organization: OrganizationWithRelations,
  options: {
    memberCount: number;
    permissions?: OrganizationPermissions;
  },
): PublicOrganization {
  const isVerified = organization.verificationStatus === 'VERIFIED';
  const canSeeContact = isVerified || options.permissions?.canEdit === true;

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    type: organization.type,
    description: organization.description,
    logoUrl: organization.logoUrl,
    websiteUrl: organization.websiteUrl,
    email: canSeeContact ? organization.email : null,
    phone: canSeeContact ? organization.phone : null,
    address: canSeeContact ? organization.address : null,
    location: {
      city: organization.city,
      state: organization.state,
      country: organization.country,
    },
    verificationStatus: organization.verificationStatus,
    verifiedAt: organization.verifiedAt?.toISOString() ?? null,
    memberCount: options.memberCount,
    expertise: organization.expertise.map(toExpertiseEntry),
    createdAt: organization.createdAt.toISOString(),
    ...(options.permissions ? { viewerPermissions: options.permissions } : {}),
  };
}

export type MemberWithUser = OrganizationMember & { user: User };

/**
 * A team member.
 *
 * Only public identity is exposed — no email, no phone, no account status.
 * A team list is a public-facing roster, and the fact that someone belongs to
 * an NGO must not also disclose how to contact them personally.
 */
export function toMemberSummary(member: MemberWithUser): OrganizationMemberSummary {
  return {
    id: member.id,
    membershipRole: member.membershipRole,
    status: member.status,
    joinedAt: member.joinedAt?.toISOString() ?? null,
    user: {
      id: member.user.id,
      fullName: member.user.fullName,
      displayName: member.user.displayName,
      avatarUrl: member.user.avatarUrl,
      role: member.user.role,
    },
  };
}

/**
 * Civic contribution counts.
 *
 * Real counts only. `problemsResolved` is `null` because allocation does not
 * exist yet — an organisation cannot be credited with resolving anything until
 * there is a record of it having been given the work. Zero would read as a
 * measured failure rather than an unbuilt feature.
 */
export function toOrganizationActivity(counts: {
  suggestionsMade: number;
  suggestionsAccepted: number;
}): OrganizationActivity {
  return {
    suggestionsMade: counts.suggestionsMade,
    suggestionsAccepted: counts.suggestionsAccepted,
    problemsResolved: null,
  };
}
