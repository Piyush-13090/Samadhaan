import type {
  OrganizationMemberRole,
  OrganizationType,
  ProblemCategory,
  VerificationStatus,
} from './problem.js';
import type { UserRole, UserStatus } from './roles.js';

/**
 * Profile contracts shared by the API and the web app.
 *
 * The central decision here is that there are **two** user shapes, not one:
 * `PublicProfile` and `AuthenticatedUser` (in auth.ts). A single shape with
 * optional private fields would leak the moment a handler forgot to strip them;
 * two separate types make "this endpoint returns the public view" checkable by
 * the compiler.
 */

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** Coarse location. Never an address — see the schema comment on `User`. */
export interface ProfileLocation {
  city: string | null;
  state: string | null;
  country: string | null;
}

/**
 * A user as anyone may see them.
 *
 * Deliberately absent: email, phone, postal code, status, `lastLoginAt`,
 * `emailVerifiedAt`. Those are account data, not identity, and nothing on a
 * public profile needs them.
 */
export interface PublicProfile {
  id: string;
  fullName: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: UserRole;
  location: ProfileLocation;
  /** ISO-8601. Rendered as "Member since". */
  createdAt: string;
  organizations: ProfileOrganizationMembership[];
}

/**
 * The signed-in user's own profile — the public view plus the account fields
 * they are entitled to see about themselves.
 */
export interface OwnProfile extends PublicProfile {
  email: string;
  phone: string | null;
  postalCode: string | null;
  status: UserStatus;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
}

/** An organisation a user belongs to, as shown on their profile. */
export interface ProfileOrganizationMembership {
  organizationId: string;
  name: string;
  slug: string;
  type: OrganizationType;
  verificationStatus: VerificationStatus;
  logoUrl: string | null;
  membershipRole: OrganizationMemberRole;
  /** ISO-8601, null while the invitation is outstanding. */
  joinedAt: string | null;
}

/**
 * Civic activity counts for a profile.
 *
 * Every field is a real count from the database. Where the underlying feature
 * does not exist yet the value is `null`, **not** zero — "we cannot measure
 * this" and "we measured zero" are different claims, and the UI renders them
 * differently. Nothing here is fabricated.
 */
export interface ProfileActivity {
  problemsReported: number;
  problemsSupported: number;
  commentsPosted: number;
  suggestionsMade: number;
  /** Counted from problems the user contributed to that reached RESOLVED. */
  problemsResolved: number;
  /**
   * Null until the impact-points ledger exists. A zero here would look like a
   * measured score of nothing rather than an unbuilt feature.
   */
  impactPoints: number | null;
}

// ---------------------------------------------------------------------------
// Organisations
// ---------------------------------------------------------------------------

// `OrganizationType`, `VerificationStatus` and `OrganizationMemberRole` are
// defined in problem.ts, which mirrors the Prisma enums. Imported rather than
// restated so there is exactly one definition of each.

export const EXPERTISE_LEVELS = ['INTERESTED', 'EXPERIENCED', 'SPECIALIST'] as const;

export type ExpertiseLevel = (typeof EXPERTISE_LEVELS)[number];

export interface OrganizationExpertiseEntry {
  id: string;
  category: ProblemCategory;
  subcategory: string | null;
  level: ExpertiseLevel;
  createdAt: string;
}

/** An organisation as anyone may see it. */
export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
  type: OrganizationType;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  /**
   * Contact details are published only for VERIFIED organisations. An
   * unverified profile is an unchecked claim, and attaching contact details to
   * one makes the platform a vector for impersonation.
   *
   * `address` is included here rather than in `location`: a street address is
   * contact-grade data, whereas city and state are the coarse identity that
   * makes an organisation findable.
   */
  email: string | null;
  phone: string | null;
  address: string | null;
  location: ProfileLocation;
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
  memberCount: number;
  expertise: OrganizationExpertiseEntry[];
  createdAt: string;
  /** What the requesting user may do here. Absent when signed out. */
  viewerPermissions?: OrganizationPermissions;
}

/**
 * What the requesting user may do with an organisation.
 *
 * Sent so the UI can hide controls the user cannot use. It is a **mirror** of
 * the server's decision, never the decision itself — every mutating endpoint
 * re-derives these server-side.
 */
export interface OrganizationPermissions {
  canEdit: boolean;
  canManageMembers: boolean;
  canManageExpertise: boolean;
  /** Always false here: verification is an administrative capability. */
  canVerify: boolean;
}

/** A member as shown on the organisation's team list. */
export interface OrganizationMemberSummary {
  id: string;
  membershipRole: OrganizationMemberRole;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'LEFT';
  joinedAt: string | null;
  user: Pick<PublicProfile, 'id' | 'fullName' | 'displayName' | 'avatarUrl' | 'role'>;
}

/** Civic contribution counts for an organisation. Real counts only. */
export interface OrganizationActivity {
  suggestionsMade: number;
  suggestionsAccepted: number;
  /** Null until allocation exists — see `ProfileActivity.impactPoints`. */
  problemsResolved: number | null;
}

// ---------------------------------------------------------------------------
// Validation bounds, shared so both sides agree
// ---------------------------------------------------------------------------

export const PROFILE_LIMITS = {
  fullNameMin: 2,
  fullNameMax: 120,
  displayNameMin: 3,
  displayNameMax: 32,
  bioMax: 500,
  localityMax: 120,
  postalCodeMin: 3,
  postalCodeMax: 16,
  urlMax: 2048,
} as const;

export const ORGANIZATION_LIMITS = {
  nameMin: 2,
  nameMax: 160,
  descriptionMax: 2000,
  localityMax: 120,
  addressMax: 300,
  subcategoryMin: 2,
  subcategoryMax: 80,
} as const;
