import type {
  AuthenticatedUser,
  OwnProfile,
  ProfileOrganizationMembership,
  PublicProfile,
} from '@samadhaan/shared';
import type {
  Organization,
  OrganizationMember,
  User,
} from '../generated/prisma/client.js';

/**
 * Every user shape the API is allowed to emit.
 *
 * All three are explicit allow-lists, not delete-lists. Spreading the row and
 * removing `passwordHash` would mean every future column is exposed by default
 * and one schema change away from leaking; here a new column stays invisible
 * until someone deliberately adds it.
 *
 * There are three shapes rather than one because the audiences differ:
 *
 *   - `toPublicProfile`        anyone, including signed-out visitors
 *   - `toOwnProfile`           the user themselves
 *   - `toAuthenticatedUser`    the session payload (auth endpoints)
 *
 * Keeping them separate makes "which fields does this endpoint publish?" a
 * question the compiler answers.
 */

/** A membership row with its organisation loaded. */
export type MembershipWithOrganization = OrganizationMember & {
  organization: Organization;
};

function toLocation(user: User) {
  return { city: user.city, state: user.state, country: user.country };
}

function toMembership(
  membership: MembershipWithOrganization,
): ProfileOrganizationMembership {
  return {
    organizationId: membership.organization.id,
    name: membership.organization.name,
    slug: membership.organization.slug,
    type: membership.organization.type,
    verificationStatus: membership.organization.verificationStatus,
    logoUrl: membership.organization.logoUrl,
    membershipRole: membership.membershipRole,
    joinedAt: membership.joinedAt?.toISOString() ?? null,
  };
}

/**
 * The public view of a user.
 *
 * Deliberately omits email, phone, postal code, account status and the login
 * timestamps. Those are account data; a public profile is identity.
 */
export function toPublicProfile(
  user: User,
  memberships: MembershipWithOrganization[] = [],
): PublicProfile {
  return {
    id: user.id,
    fullName: user.fullName,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    role: user.role,
    location: toLocation(user),
    createdAt: user.createdAt.toISOString(),
    // Only memberships the person has actually accepted. An outstanding
    // invitation is not a public association — publishing it would let anyone
    // imply an affiliation by inviting someone who never replied.
    organizations: memberships
      .filter((membership) => membership.status === 'ACTIVE')
      .map(toMembership),
  };
}

/** The signed-in user's own profile: the public view plus their account data. */
export function toOwnProfile(
  user: User,
  memberships: MembershipWithOrganization[] = [],
): OwnProfile {
  return {
    ...toPublicProfile(user, memberships),
    email: user.email,
    phone: user.phone,
    postalCode: user.postalCode,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    // The owner sees pending invitations, which the public view hides.
    organizations: memberships
      .filter((membership) => membership.status !== 'LEFT')
      .map(toMembership),
  };
}

/** The session payload returned by the auth endpoints. */
export function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
  };
}
