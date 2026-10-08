/**
 * AI Priority Engine (Prompt 21).
 *
 * An **advisory** civic priority for problems under government review: an
 * explainable heuristic score over documented features, some of them
 * AI-assisted (with confidence). It never allocates, approves, rejects or
 * resolves anything. Government officials decide, and may override the tier
 * with a recorded reason; the AI assessment itself is never edited.
 *
 * Not a validated decision-making model. See docs/AI_PRIORITY_ENGINE.md.
 */

export const PRIORITY_TIERS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type PriorityTier = (typeof PRIORITY_TIERS)[number];

/** Queue filter values: a tier, or problems not yet assessed. */
export const PRIORITY_FILTERS = [...PRIORITY_TIERS, 'UNASSESSED'] as const;
export type PriorityFilter = (typeof PRIORITY_FILTERS)[number];

export const PRIORITY_FEATURES = [
  'severity',
  'urgency',
  'communityImpact',
  'safetyRisk',
  'geographicImpact',
  'recency',
  'affectedPopulation',
  'evidence',
] as const;
export type PriorityFeatureKey = (typeof PRIORITY_FEATURES)[number];

export const PRIORITY_OVERRIDE_REASON_MIN = 10;
export const PRIORITY_OVERRIDE_REASON_MAX = 1000;

/** One feature in the breakdown. Values are 0–1; contribution is in points. */
export interface PriorityFeatureView {
  key: PriorityFeatureKey;
  label: string;
  /** Null when the feature was unavailable (never a silent zero). */
  value: number | null;
  /** 0–1. How much the inputs support the value. */
  confidence: number;
  available: boolean;
  /** Configured weight, 0–1. */
  weight: number;
  /** Points this feature added to the 0–100 score. */
  contribution: number;
  /** Where the value came from, in words. */
  source: string;
  /** Short evidence: counts, analysis findings, phrases from the report. */
  evidence: string[];
  /** Why it is unavailable, or a caveat. */
  note: string | null;
}

export interface PriorityReason {
  /** `driver` raises priority; `warning` limits trust in the assessment. */
  kind: 'driver' | 'warning' | 'info';
  feature: PriorityFeatureKey | null;
  text: string;
}

/** Supporting civic guidance (RAG). Context only — never a score input. */
export interface PriorityGuidance {
  sourceId: string;
  chunkId: string;
  title: string;
  sectionTitle: string | null;
  href: string;
}

export interface PriorityAssessmentView {
  id: string;
  score: number;
  tier: PriorityTier;
  /** 0–1, weighted mean confidence of the features used. */
  confidence: number;
  /** 0–1, share of the configured weight whose feature was available. */
  dataCompleteness: number;
  /** Low confidence or completeness: treat the tier as provisional. */
  provisional: boolean;
  reasons: PriorityReason[];
  breakdown: PriorityFeatureView[];
  model: {
    scoringModel: string;
    scoringVersion: string;
    featureVersion: string;
    /** The AI-assisted features: COMPLETED, REUSED, UNAVAILABLE or FAILED. */
    aiStatus: string;
    aiModel: { name: string; version: string; promptVersion: string | null } | null;
  };
  guidance: PriorityGuidance[];
  calculatedAt: string;
  /** Last recalculation that produced the same result. */
  confirmedAt: string;
}

export interface PriorityOverrideView {
  tier: PriorityTier;
  reason: string;
  organizationName: string;
  overriddenBy: string | null;
  overriddenAt: string;
  /** The AI assessment when the decision was made. */
  aiTierAtOverride: PriorityTier | null;
  aiScoreAtOverride: number | null;
}

export interface PriorityHistoryEntry {
  id: string;
  score: number;
  tier: PriorityTier;
  calculatedAt: string;
  trigger: string;
  changes: string[];
}

/** `GET /government/:slug/problems/:publicId/priority` */
export interface GovernmentPriorityView {
  assessment: PriorityAssessmentView | null;
  override: PriorityOverrideView | null;
  effective: { tier: PriorityTier | null; source: 'AI' | 'OVERRIDE' | null };
  history: PriorityHistoryEntry[];
  canOverride: boolean;
}

/** In the government review queue. */
export interface QueuePriority {
  /** Effective tier: the override when there is one, else the AI tier. */
  tier: PriorityTier | null;
  aiTier: PriorityTier | null;
  score: number | null;
  overridden: boolean;
  confidence: number | null;
  dataCompleteness: number | null;
  provisional: boolean;
  /** The top reasons, short. */
  summary: string[];
}

/**
 * `GET /problems/:publicId/priority` — what anyone who can see the problem
 * may see. No score, no confidence figures, no override or its reason.
 */
export interface PublicPriorityView {
  level: PriorityTier | null;
  /** Plain reasons from public signals. */
  reasons: string[];
  assessedAt: string | null;
}
