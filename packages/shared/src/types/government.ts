import type { GovernmentAllocationPanel } from './allocation.js';
import type { BoundingBox } from './geo.js';
import type { ProblemListItem } from './discovery.js';
import type {
  OrganizationMemberRole,
  ProblemCategory,
  ProblemImageKind,
  ProblemSeverity,
  ProblemStatus,
  ProblemUrgency,
  ProcessingStatus,
  VerificationStatus,
} from './problem.js';

/**
 * The government portal (Prompt 15): review and civic intelligence for a
 * government office, inside its jurisdiction.
 *
 * Access is three conditions, all checked server-side on every request: the
 * platform role is GOVERNMENT, the user is an ACTIVE member of a GOVERNMENT
 * organisation, and the problem is inside that organisation's jurisdiction.
 * A government user is not an administrator and sees nothing outside it.
 *
 * Allocation to organisations, resolution and verification of completed work
 * are later milestones and have no representation here.
 */

export const JURISDICTION_TYPES = [
  'MUNICIPAL_CORPORATION',
  'MUNICIPALITY',
  'DISTRICT_ADMINISTRATION',
  'URBAN_LOCAL_BODY',
  'GOVERNMENT_DEPARTMENT',
  'PUBLIC_AUTHORITY',
] as const;

export type JurisdictionType = (typeof JURISDICTION_TYPES)[number];

/** What a government office covers. */
export interface Jurisdiction {
  type: JurisdictionType | null;
  name: string | null;
  /** Which rule decides membership of the area. `none` means nothing is visible. */
  basis: 'boundary' | 'cities' | 'postal-codes' | 'none';
  cities: string[];
  postalCodes: string[];
  /** Extent of the boundary, for opening the map. Null without a boundary. */
  bbox: BoundingBox | null;
}

/** One government office in the user's list. */
export interface GovernmentWorkspaceSummary {
  organizationId: string;
  slug: string;
  name: string;
  jurisdictionType: JurisdictionType | null;
  jurisdictionName: string | null;
  membershipRole: OrganizationMemberRole;
  isAccessible: boolean;
}

/** `GET /government/:slug/context` */
export interface GovernmentContext {
  organization: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
    verificationStatus: VerificationStatus;
    jurisdiction: Jurisdiction;
  };
  membership: { id: string; membershipRole: OrganizationMemberRole };
  viewer: { name: string; firstName: string };
  permissions: {
    /** Move problems through the review transitions. */
    canReview: boolean;
    canAddNotes: boolean;
  };
}

// ---------------------------------------------------------------------------
// Review transitions
// ---------------------------------------------------------------------------

/**
 * The review transitions a government office may make in this milestone.
 *
 * Deliberately only the front of the lifecycle. VERIFIED → IN_PROGRESS and
 * IN_PROGRESS → RESOLVED belong to allocation and resolution (later prompts),
 * so they are not here and the API refuses them.
 */
export const GOVERNMENT_REVIEW_TRANSITIONS: Readonly<
  Partial<Record<ProblemStatus, readonly ProblemStatus[]>>
> = {
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['VERIFIED', 'REJECTED'],
};

export function allowedReviewTransitions(from: ProblemStatus): ProblemStatus[] {
  return [...(GOVERNMENT_REVIEW_TRANSITIONS[from] ?? [])];
}

/** A rejection must say why: the reporter is told their report was rejected. */
export const REVIEW_NOTE_REQUIRED: readonly ProblemStatus[] = ['REJECTED'];

export const REVIEW_NOTE_MAX_LENGTH = 1000;
export const INTERNAL_NOTE_MAX_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

/** Every status a government list may filter by. DRAFT was never published. */
export const GOVERNMENT_STATUS_FILTERS = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'IN_PROGRESS',
  'RESOLVED',
  'REJECTED',
  'DUPLICATE',
  'ARCHIVED',
] as const satisfies readonly ProblemStatus[];

export type GovernmentStatusFilter = (typeof GOVERNMENT_STATUS_FILTERS)[number];

/** The statuses that make up "needs review". */
export const REVIEW_QUEUE_STATUSES = ['SUBMITTED', 'UNDER_REVIEW'] as const;

/** Duplicate intelligence, from Prompt 8's candidates — not a new judgement. */
export const DUPLICATE_FILTERS = ['possible', 'confirmed', 'none'] as const;
export type DuplicateFilter = (typeof DUPLICATE_FILTERS)[number];

export const AI_STATUS_FILTERS = ['completed', 'pending', 'failed', 'none'] as const;
export type AiStatusFilter = (typeof AI_STATUS_FILTERS)[number];

export const GOVERNMENT_SORTS = [
  'queue',
  'newest',
  'oldest',
  'severity',
  'supported',
] as const;
export type GovernmentSort = (typeof GOVERNMENT_SORTS)[number];

export const GOVERNMENT_PAGE_LIMIT_DEFAULT = 20;
export const GOVERNMENT_PAGE_LIMIT_MAX = 50;

export interface GovernmentQueueItem extends ProblemListItem {
  followCount: number;
  ai: {
    status: ProcessingStatus | null;
    category: ProblemCategory | null;
    subcategory: string | null;
    /** 0–1, from the analysis itself. Null when the model reported none. */
    confidence: number | null;
  };
  duplicates: {
    /** Open candidates from duplicate detection — possible, not confirmed. */
    possible: number;
    confirmedOf: string | null;
  };
}

export interface GovernmentProblemPage {
  items: GovernmentQueueItem[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const TREND_RANGES = [7, 30, 90] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

/** Counts inside the jurisdiction. Every one is a database count. */
export interface GovernmentMetrics {
  totalReports: number;
  pendingReview: number;
  submitted: number;
  underReview: number;
  verified: number;
  /** HIGH or CRITICAL, and still open. */
  highSeverityOpen: number;
  inProgress: number;
  resolved: number;
  rejected: number;
  duplicates: number;
  /** Allocations this office has made (Prompt 16). */
  pendingAllocations: number;
  acceptedAllocations: number;
  declinedAllocations: number;
}

export interface TrendPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  reported: number;
  resolved: number;
}

export interface GovernmentActivityEntry {
  id: string;
  kind:
    | 'STATUS_CHANGED'
    | 'NOTE_ADDED'
    | 'DUPLICATE_CONFIRMED'
    | 'ALLOCATION_CREATED'
    | 'ALLOCATION_ACCEPTED'
    | 'ALLOCATION_DECLINED'
    | 'ALLOCATION_CANCELLED';
  /** The organisation an allocation entry concerns. Public name only. */
  organizationName: string | null;
  problemPublicId: string;
  problemTitle: string;
  fromStatus: ProblemStatus | null;
  toStatus: ProblemStatus | null;
  /**
   * A member of this office is named. Anyone else is described by role only —
   * the activity feed is not a way to learn who reported or reviewed what.
   */
  actor: {
    name: string | null;
    kind: 'TEAM' | 'CITIZEN' | 'ORGANIZATION' | 'OTHER' | 'SYSTEM';
  };
  createdAt: string;
}

/** `GET /government/:slug/dashboard?range=30` */
export interface GovernmentDashboard {
  metrics: GovernmentMetrics;
  trend: { rangeDays: TrendRange; points: TrendPoint[] };
  reviewQueue: GovernmentQueueItem[];
  recentActivity: GovernmentActivityEntry[];
}

// ---------------------------------------------------------------------------
// Problem detail
// ---------------------------------------------------------------------------

export interface GovernmentInternalNote {
  id: string;
  body: string;
  visibility: 'INTERNAL';
  author: { name: string };
  createdAt: string;
}

export interface GovernmentAuditEntry extends GovernmentActivityEntry {
  /** The reviewer's note on a status change, when one was given. */
  note: string | null;
}

export interface GovernmentProblemDetail {
  problem: {
    publicId: string;
    title: string;
    description: string;
    category: ProblemCategory;
    subcategory: string | null;
    status: ProblemStatus;
    severity: ProblemSeverity;
    urgency: ProblemUrgency;
    createdAt: string;
    updatedAt: string;
    location: {
      address: string | null;
      city: string | null;
      state: string | null;
      postalCode: string | null;
      latitude: number;
      longitude: number;
    };
    images: Array<{ url: string; kind: ProblemImageKind }>;
  };
  /** The latest initial analysis, with the provenance a reviewer needs. */
  analysis: {
    status: ProcessingStatus;
    modelName: string;
    modelVersion: string;
    analysedAt: string;
    processingMs: number | null;
    category: ProblemCategory | null;
    subcategory: string | null;
    severity: ProblemSeverity | null;
    urgency: ProblemUrgency | null;
    severityScore: number | null;
    confidence: number | null;
    summary: string | null;
    observations: string[];
    textOnly: boolean;
  } | null;
  duplicates: {
    confirmedOf: { publicId: string; title: string } | null;
    possible: Array<{
      publicId: string;
      title: string;
      status: ProblemStatus;
      /** 0–1 combined score from duplicate detection. */
      similarity: number | null;
      verdict: 'PENDING' | 'LIKELY_DUPLICATE';
      signals: {
        text: number | null;
        geographic: number | null;
        category: number | null;
        image: number | null;
      };
      distanceMeters: number | null;
    }>;
  };
  community: {
    supporters: number;
    followers: number;
    comments: number;
    lastCommentAt: string | null;
  };
  nearby: {
    radiusMeters: number;
    total: number;
    sameCategory: number;
    items: Array<{
      publicId: string;
      title: string;
      category: ProblemCategory;
      severity: ProblemSeverity;
      status: ProblemStatus;
      distanceMeters: number;
    }>;
  };
  allowedTransitions: ProblemStatus[];
  /** Prompt 16: allocation state, history and candidates. */
  allocation: GovernmentAllocationPanel;
  notes: GovernmentInternalNote[];
  audit: GovernmentAuditEntry[];
}

export const NEARBY_RADIUS_METERS = 1000;
