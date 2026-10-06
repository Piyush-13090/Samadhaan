import type { ProblemCategory, VerificationStatus } from './problem.js';
import type { ExpertiseLevel, ProfileLocation } from './profile.js';
import type {
  OrganizationProblemItem,
  OrganizationProblemPage,
  WorkspaceOrganizationType,
} from './workspace.js';

/**
 * AI organisation matching (Prompt 14).
 *
 * A match says an organisation is **potentially relevant** to a problem. It is
 * not an assignment, an allocation or an endorsement — those are later,
 * human workflows. `relevance` is a weighted score from an embedding-assisted
 * heuristic baseline: it orders organisations, and it is **not** a calibrated
 * probability or a model confidence, so the UI never calls it one.
 */

/** The signals behind every score, each 0–1 or null when unavailable. */
export const MATCH_SIGNALS = [
  'semantic',
  'expertise',
  'category',
  'geographic',
  'capability',
  'activity',
] as const;

export type MatchSignal = (typeof MATCH_SIGNALS)[number];

/** Evidence codes the engine emits. The UI words them; the engine never writes prose. */
export const MATCH_REASON_CODES = [
  'EXPERTISE_STRONG',
  'EXPERTISE_RELATED',
  'SEMANTIC_HIGH',
  'SEMANTIC_MODERATE',
  'WITHIN_SERVICE_AREA',
  'SAME_CITY',
  'IN_REGION',
  'TYPE_FIT',
  'RELATED_ACTIVITY',
] as const;

export type MatchReasonCode = (typeof MATCH_REASON_CODES)[number];

export interface MatchReason {
  code: MatchReasonCode;
  /** Distance in metres for geographic reasons, a count for activity, else the signal value. */
  value: number;
}

export interface MatchEvidence {
  /** 0–1 relevance. Show as "92% relevance", never as confidence. */
  relevance: number;
  rank: number;
  signals: Record<MatchSignal, number | null>;
  reasons: MatchReason[];
  /** The declared areas of work that made this a match, strongest first. */
  matchedExpertise: Array<{
    category: ProblemCategory;
    subcategory: string | null;
    level: ExpertiseLevel;
  }>;
  computedAt: string;
}

/** One organisation that may be able to help, as anyone may see it. */
export interface ProblemOrganizationMatch extends MatchEvidence {
  organization: {
    slug: string;
    name: string;
    type: WorkspaceOrganizationType;
    logoUrl: string | null;
    verificationStatus: VerificationStatus;
    location: Pick<ProfileLocation, 'city' | 'state'>;
  };
}

/** `GET /problems/:publicId/matches` */
export interface ProblemMatches {
  /**
   * `ready` — matched; `pending` — queued or running; `unavailable` — the
   * problem is not eligible (not yet published, a duplicate, closed) or
   * matching is switched off.
   */
  state: 'ready' | 'pending' | 'unavailable';
  matchingVersion: string | null;
  computedAt: string | null;
  items: ProblemOrganizationMatch[];
}

export type MatchStatus = 'CALCULATED' | 'STALE' | 'DISMISSED';

/** A recommended problem in an organisation's workspace. */
export interface RecommendationItem extends OrganizationProblemItem {
  match: MatchEvidence & { status: MatchStatus };
}

export interface RecommendationPage extends Omit<OrganizationProblemPage, 'items'> {
  items: RecommendationItem[];
}

export const RECOMMENDATION_SORTS = [
  'relevance',
  'recent',
  'severity',
  'distance',
] as const;
export type RecommendationSort = (typeof RECOMMENDATION_SORTS)[number];

/** "At least N% relevance" filter steps. */
export const MIN_RELEVANCE_OPTIONS = [0.5, 0.6, 0.7, 0.8] as const;

export const RECOMMENDATION_VIEWS = ['active', 'dismissed'] as const;
export type RecommendationView = (typeof RECOMMENDATION_VIEWS)[number];
