import type { MatchReason } from './matching.js';
import type {
  OrganizationMemberRole,
  ProblemCategory,
  ProblemSeverity,
  ProblemStatus,
  VerificationStatus,
} from './problem.js';
import type { ExpertiseLevel } from './profile.js';
import type { WorkspaceOrganizationType } from './workspace.js';

/**
 * Government allocation (Prompt 16): an authorised official selecting an
 * organisation for a verified problem, and the organisation's response.
 *
 * Not matching. A match (Prompt 14) says an organisation *appears* relevant; an
 * allocation says a government office *chose* it. Matches are shown to the
 * official as decision support only — nothing allocates automatically.
 */

export const ALLOCATION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

/**
 * The state machine. Only a PENDING allocation moves, and only to one of three
 * ends. EXPIRED is reserved for a response deadline; nothing sets it yet.
 */
export const ALLOCATION_TRANSITIONS: Readonly<
  Partial<Record<AllocationStatus, readonly AllocationStatus[]>>
> = {
  PENDING: ['ACCEPTED', 'DECLINED', 'CANCELLED'],
};

export function canTransitionAllocation(from: AllocationStatus, to: AllocationStatus): boolean {
  return (ALLOCATION_TRANSITIONS[from] ?? []).includes(to);
}

/** PENDING and ACCEPTED occupy a problem; only one may exist at a time. */
export const ACTIVE_ALLOCATION_STATUSES = ['PENDING', 'ACCEPTED'] as const;

/** Membership roles that may accept or decline for an organisation. */
export const ALLOCATION_RESPONDER_ROLES = ['OWNER', 'ADMIN'] as const satisfies readonly OrganizationMemberRole[];

export const ALLOCATION_NOTE_MAX_LENGTH = 1000;

/** Why an organisation cannot be selected. */
export type AllocationIneligibility =
  | 'NOT_VERIFIED'
  | 'SUSPENDED'
  | 'REJECTED'
  | 'INACTIVE';

// ---------------------------------------------------------------------------
// Government side
// ---------------------------------------------------------------------------

/** An organisation an official may consider, with any match evidence. */
export interface AllocationCandidate {
  organization: {
    id: string;
    slug: string;
    name: string;
    type: WorkspaceOrganizationType;
    logoUrl: string | null;
    verificationStatus: VerificationStatus;
    location: { city: string | null; state: string | null };
  };
  /** From organisation matching; null for an organisation found by search. */
  match: {
    relevance: number;
    reasons: MatchReason[];
    matchedExpertise: Array<{
      category: ProblemCategory;
      subcategory: string | null;
      level: ExpertiseLevel;
    }>;
  } | null;
  eligible: boolean;
  ineligibleReason: AllocationIneligibility | null;
  /** This organisation already declined this problem once. */
  previouslyDeclined: boolean;
}

/** An allocation as the allocating office sees it — everything. */
export interface GovernmentAllocationView {
  id: string;
  status: AllocationStatus;
  organization: {
    slug: string;
    name: string;
    type: WorkspaceOrganizationType;
    logoUrl: string | null;
  };
  /** Shared with the organisation. */
  instructions: string | null;
  /** Government-only. Null for officials of another office. */
  internalReason: string | null;
  responseNote: string | null;
  /** Shared with the allocating office. Null for officials of another office. */
  declineReason: string | null;
  cancellationReason: string | null;
  allocatedBy: { name: string | null; office: string };
  proposedAt: string;
  respondedAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  cancelledAt: string | null;
  /** This office made the allocation, so it may cancel while pending. */
  ownedByThisOffice: boolean;
}

/** The allocation section of a government problem view. */
export interface GovernmentAllocationPanel {
  /** Whether a new allocation can be sent now, and if not, why. */
  canAllocate: boolean;
  blockedReason: 'NOT_VERIFIED' | 'ACTIVE_ALLOCATION' | null;
  active: GovernmentAllocationView | null;
  /** Newest first, including the active one. */
  history: GovernmentAllocationView[];
  /** Matched organisations, best first, with eligibility. */
  candidates: AllocationCandidate[];
  /** When the problem was verified, from the audit log. */
  verifiedAt: string | null;
}

// ---------------------------------------------------------------------------
// Organisation side
// ---------------------------------------------------------------------------

export interface OrganizationAllocationItem {
  id: string;
  status: AllocationStatus;
  problem: {
    publicId: string;
    title: string;
    category: ProblemCategory;
    subcategory: string | null;
    severity: ProblemSeverity;
    status: ProblemStatus;
    area: string | null;
    city: string | null;
  };
  government: { name: string };
  proposedAt: string;
  respondedAt: string | null;
}

export interface OrganizationAllocationPage {
  items: OrganizationAllocationItem[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

/** `GET /organizations/:slug/allocations/:id` — what a decision needs. */
export interface OrganizationAllocationDetail extends OrganizationAllocationItem {
  problem: OrganizationAllocationItem['problem'] & {
    description: string;
    address: string | null;
    state: string | null;
    latitude: number;
    longitude: number;
    reportedAt: string;
    voteCount: number;
    aiSubcategory: string | null;
  };
  instructions: string | null;
  responseNote: string | null;
  /** The organisation's own reason, when it declined. */
  declineReason: string | null;
  cancellationReason: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  cancelledAt: string | null;
  /** Whether the viewer may accept or decline (OWNER/ADMIN, while PENDING). */
  canRespond: boolean;
}

export const ALLOCATION_VIEWS = ['pending', 'active', 'past', 'all'] as const;
export type AllocationView = (typeof ALLOCATION_VIEWS)[number];

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * On a public problem page once an allocation is accepted: who is on it, and
 * nothing else — no notes, no reasons, no history.
 */
export interface ProblemAssignment {
  organization: {
    slug: string;
    name: string;
    type: WorkspaceOrganizationType;
    logoUrl: string | null;
  };
  assignedAt: string;
}

