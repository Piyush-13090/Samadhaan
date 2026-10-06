import type { ProblemListItem } from './discovery.js';
import type { RecommendationItem } from './matching.js';
import type {
  OrganizationMemberRole,
  OrganizationType,
  ProblemCategory,
  ProblemSeverity,
  VerificationStatus,
} from './problem.js';
import type {
  ExpertiseLevel,
  OrganizationMemberSummary,
  PublicOrganization,
} from './profile.js';

/**
 * The organisation workspace — where NGO, university and industry members work
 * on Samadhaan.
 *
 * Access is derived from membership, never from anything the client sends: the
 * API resolves the organisation from the URL slug and then checks that the
 * signed-in user holds an ACTIVE membership in it. A slug is an address, not a
 * credential.
 *
 * Relevance here is **deterministic** — expertise category, service area,
 * severity, recency. It is a discovery aid, not the AI matching engine, and no
 * response carries anything that could be mistaken for a match score.
 */

/** Organisation types that use this workspace. Government has its own. */
export const WORKSPACE_ORGANIZATION_TYPES = [
  'NGO',
  'UNIVERSITY',
  'INDUSTRY',
] as const satisfies readonly OrganizationType[];

export type WorkspaceOrganizationType = (typeof WORKSPACE_ORGANIZATION_TYPES)[number];

export function isWorkspaceOrganizationType(
  value: unknown,
): value is WorkspaceOrganizationType {
  return (
    typeof value === 'string' &&
    (WORKSPACE_ORGANIZATION_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Radius around an organisation's registered location that counts as its
 * service area, in metres. One fixed, published number rather than a tuned
 * one — the point is that a member can predict what appears.
 */
export const ORGANIZATION_SERVICE_RADIUS_METERS = 25_000;

// ---------------------------------------------------------------------------
// Workspace context
// ---------------------------------------------------------------------------

/** One organisation in the switcher. */
export interface WorkspaceSummary {
  organizationId: string;
  slug: string;
  name: string;
  type: WorkspaceOrganizationType;
  logoUrl: string | null;
  verificationStatus: VerificationStatus;
  membershipRole: OrganizationMemberRole;
  /**
   * False when the organisation is suspended or deactivated. Still listed, so a
   * member understands why the workspace is closed rather than seeing it vanish.
   */
  isAccessible: boolean;
}

/** An invitation the signed-in user has not answered yet. */
export interface WorkspaceInvitation {
  /** The membership row; accepting or declining acts on it. */
  membershipId: string;
  membershipRole: OrganizationMemberRole;
  invitedAt: string;
  organization: {
    slug: string;
    name: string;
    type: WorkspaceOrganizationType;
    logoUrl: string | null;
    verificationStatus: VerificationStatus;
  };
}

/** `GET /organizations/mine` */
export interface MyOrganizations {
  workspaces: WorkspaceSummary[];
  invitations: WorkspaceInvitation[];
}

/**
 * What the signed-in member may do in this workspace.
 *
 * A mirror of the server's decision so the UI can hide controls, never the
 * decision itself — every mutating endpoint re-checks.
 */
export interface WorkspacePermissions {
  canEditProfile: boolean;
  canManageExpertise: boolean;
  canManageMembers: boolean;
  /** Roles this member may give someone else. Empty for a MEMBER. */
  assignableRoles: OrganizationMemberRole[];
}

/** `GET /organizations/:slug/workspace` */
export interface OrganizationWorkspace {
  /** Contact details are always included: the reader is a member. */
  organization: PublicOrganization;
  membership: {
    id: string;
    membershipRole: OrganizationMemberRole;
    joinedAt: string | null;
  };
  permissions: WorkspacePermissions;
  /** Coordinates are private to members; they drive distance filters. */
  coordinates: { latitude: number; longitude: number } | null;
}

// ---------------------------------------------------------------------------
// Problem discovery
// ---------------------------------------------------------------------------

/**
 * Why a problem surfaced for this organisation. Every reason is a plain,
 * checkable fact about the problem and the organisation's own profile.
 */
export const RELEVANCE_REASONS = [
  /** The problem's category is one of the organisation's areas of work. */
  'EXPERTISE_MATCH',
  /** …and its subcategory matches the one the organisation named. */
  'SUBCATEGORY_MATCH',
  /** Within the service radius of the organisation's registered location. */
  'IN_SERVICE_AREA',
  /** Same city as the organisation, when it has no coordinates. */
  'SAME_CITY',
] as const;

export type RelevanceReason = (typeof RELEVANCE_REASONS)[number];

/**
 * A problem as the workspace lists it: the public feed item plus the reasons
 * it appears and, when an analysis completed, the AI classification.
 */
export interface OrganizationProblemItem extends ProblemListItem {
  relevance: {
    reasons: RelevanceReason[];
    /** The organisation's declared level for this category, if any. */
    expertiseLevel: ExpertiseLevel | null;
  };
  /**
   * The AI classification, when one completed. Findings only — never the
   * model's raw output or reasoning.
   */
  ai: {
    category: ProblemCategory | null;
    subcategory: string | null;
    severity: ProblemSeverity | null;
    /** 0–1. */
    confidence: number | null;
  } | null;
}

/** Which problems a listing covers. */
export const WORKSPACE_PROBLEM_SCOPES = [
  /** Every published problem, ordered by relevance. */
  'all',
  /** Opportunities: an area of work, in the service area. */
  'relevant',
] as const;

export type WorkspaceProblemScope = (typeof WORKSPACE_PROBLEM_SCOPES)[number];

export const WORKSPACE_PROBLEM_SORTS = [
  'relevance',
  'recent',
  'severity',
  'supported',
  'distance',
] as const;

export type WorkspaceProblemSort = (typeof WORKSPACE_PROBLEM_SORTS)[number];

/** "Recently reported" windows, in days. */
export const REPORTED_WITHIN_OPTIONS = [1, 7, 30, 90] as const;

export type ReportedWithinDays = (typeof REPORTED_WITHIN_OPTIONS)[number];

export const WORKSPACE_PROBLEMS_DEFAULT_LIMIT = 12;
export const WORKSPACE_PROBLEMS_MAX_LIMIT = 50;
/** Deep offsets get slow and nobody pages that far; search narrows instead. */
export const WORKSPACE_PROBLEMS_MAX_PAGE = 200;

/** `GET /organizations/:slug/problems` */
export interface OrganizationProblemPage {
  items: OrganizationProblemItem[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  /** Where distances are measured from. */
  origin: {
    kind: 'organization' | 'none';
    /** Radius applied by a distance filter, in metres. Null when unfiltered. */
    radiusMeters: number | null;
  };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** `GET /organizations/:slug/dashboard`. Every number is counted. */
export interface OrganizationDashboard {
  viewer: {
    firstName: string;
    membershipRole: OrganizationMemberRole;
  };
  metrics: {
    /** Open problems in an area of work and in the service area. */
    opportunities: number;
    /** Of those, reported in the last seven days. */
    newOpportunities: number;
    /** Distinct problems supported by the organisation's active members. */
    problemsSupportedByTeam: number;
    suggestionsMade: number;
    suggestionsAccepted: number;
    teamMembers: number;
    /** Pending invitations. Null for a member who cannot manage the team. */
    pendingInvitations: number | null;
    /** Allocation requests awaiting a response (Prompt 16). */
    pendingAllocations: number;
    /** Accepted allocations whose problem is in progress. */
    activeAssignments: number;
  };
  /** Open opportunities per area of work, for the declared categories. */
  opportunitiesByCategory: Array<{ category: ProblemCategory; count: number }>;
  /** Top opportunities by the deterministic rules, most relevant first. */
  relevantProblems: OrganizationProblemItem[];
  /**
   * Top AI recommendations (Prompt 14) and how many there are. Empty until
   * matching has run; the deterministic list above is the fallback.
   */
  recommendations: { total: number; items: RecommendationItem[] };
  /** Newest open problems in the service area, any category. */
  recentProblems: OrganizationProblemItem[];
  teamSummary: {
    total: number;
    byRole: Record<OrganizationMemberRole, number>;
    /** Most recently joined, for the dashboard card. */
    recentMembers: OrganizationMemberSummary[];
  };
  /** What is missing for discovery to work well. */
  setup: {
    hasExpertise: boolean;
    hasLocation: boolean;
  };
}

// ---------------------------------------------------------------------------
// Team management
// ---------------------------------------------------------------------------

/** Roles an invitation may carry. Ownership is transferred after joining. */
export const INVITABLE_MEMBER_ROLES = [
  'ADMIN',
  'MEMBER',
] as const satisfies readonly OrganizationMemberRole[];

export type InvitableMemberRole = (typeof INVITABLE_MEMBER_ROLES)[number];
