import type { ImpactTransactionType, ReputationTier } from '@samadhaan/shared';

/**
 * The point rules (Prompt 23) — one place, versioned.
 *
 * Every transaction records the version it was awarded under. Changing a value
 * means adding POINT_RULES_V2 and pointing CURRENT_RULES at it; transactions
 * already in the ledger keep their version and amount — history is never
 * silently recalculated.
 *
 * Values are a documented starting point, not tuned numbers.
 */
export const POINT_RULES_V1 = {
  version: 'POINT_RULES_V1',
  points: {
    /** Filing a report earns nothing by itself — verification does. */
    PROBLEM_REPORTED: 0,
    PROBLEM_VERIFIED: 20,
    /** Confirming your own report duplicates a verified one. */
    DUPLICATE_IDENTIFIED: 10,
    /** On resolution: an early, substantive comment on the problem. */
    USEFUL_COMMENT: 5,
    /** On resolution: early support for the problem. */
    PROBLEM_SUPPORTED: 2,
    /** On resolution: tasks and milestones completed on its project. */
    TASK_COMPLETED: 5,
    MILESTONE_COMPLETED: 5,
    /** On resolution: approved completion evidence. */
    RESOLUTION_EVIDENCE_SUBMITTED: 10,
    /** On resolution: the manager who requested the approved verification. */
    PROJECT_CONTRIBUTION: 10,
    /** On resolution: the original reporter. */
    PROBLEM_RESOLVED_REPORTER: 30,
    /** On resolution: reporters of confirmed duplicates of it. */
    PROBLEM_RESOLVED_CORROBORATOR: 10,
    /** On resolution: approved evidence the AI review rated high quality. */
    QUALITY_BONUS: 5,
  },
  caps: {
    /** Per user, rolling 30 days — beyond these, nothing more is awarded. */
    verifiedReportsPer30Days: 20,
    duplicatesPer30Days: 10,
    communityPer30Days: 30,
    /** Per resolved problem. */
    communityContributorsPerProblem: 25,
    tasksPerUserPerProject: 3,
    milestonesPerUserPerProject: 2,
    tasksPerProject: 20,
  },
  thresholds: {
    /** A comment shorter than this is not a "useful" contribution. */
    commentMinChars: 20,
    /** Evidence quality (0–100, AI review) for the quality bonus. */
    qualityBonusMinEvidenceQuality: 80,
    /** Award notifications are sent only at or above this total. */
    notifyMinPoints: 10,
  },
} as const;

export const CURRENT_RULES = POINT_RULES_V1;
export type PointRules = typeof POINT_RULES_V1;

/** Which transaction types share a rolling cap. */
export const CAP_GROUPS: Partial<
  Record<ImpactTransactionType, { types: ImpactTransactionType[]; cap: number }>
> = {
  PROBLEM_VERIFIED: {
    types: ['PROBLEM_VERIFIED'],
    cap: CURRENT_RULES.caps.verifiedReportsPer30Days,
  },
  DUPLICATE_IDENTIFIED: {
    types: ['DUPLICATE_IDENTIFIED'],
    cap: CURRENT_RULES.caps.duplicatesPer30Days,
  },
  USEFUL_COMMENT: {
    types: ['USEFUL_COMMENT', 'PROBLEM_SUPPORTED'],
    cap: CURRENT_RULES.caps.communityPer30Days,
  },
  PROBLEM_SUPPORTED: {
    types: ['USEFUL_COMMENT', 'PROBLEM_SUPPORTED'],
    cap: CURRENT_RULES.caps.communityPer30Days,
  },
};

/** Credit for these comes only from a resolved problem; their problems are "resolved contributions". */
export const RESOLUTION_TYPES: readonly ImpactTransactionType[] = [
  'PROBLEM_RESOLVED',
  'USEFUL_COMMENT',
  'PROBLEM_SUPPORTED',
  'TASK_COMPLETED',
  'MILESTONE_COMPLETED',
  'RESOLUTION_EVIDENCE_SUBMITTED',
  'PROJECT_CONTRIBUTION',
  'QUALITY_BONUS',
];

/** One award per user per event: the ledger's unique key. Never includes the rule version. */
export function idempotencyKey(
  type: ImpactTransactionType,
  entityId: string,
  userId: string,
  role?: string,
): string {
  return [type, entityId, userId, role].filter(Boolean).join(':');
}

// ------------------------------------------------------------------- tiers

/**
 * Tiers need impact points **and** a minimum reputation, so volume alone
 * cannot reach the top. Thresholds are configurable and not validated.
 */
export const TIERS: ReadonlyArray<{
  tier: ReputationTier;
  minPoints: number;
  minReputation: number;
  label: string;
}> = [
  { tier: 'NEW_CONTRIBUTOR', minPoints: 0, minReputation: 0, label: 'New Contributor' },
  {
    tier: 'ACTIVE_CONTRIBUTOR',
    minPoints: 100,
    minReputation: 0,
    label: 'Active Contributor',
  },
  {
    tier: 'TRUSTED_CONTRIBUTOR',
    minPoints: 300,
    minReputation: 55,
    label: 'Trusted Contributor',
  },
  { tier: 'CIVIC_CHAMPION', minPoints: 700, minReputation: 65, label: 'Civic Champion' },
  { tier: 'CIVIC_LEADER', minPoints: 1500, minReputation: 75, label: 'Civic Leader' },
];

export function tierFor(points: number, reputation: number): ReputationTier {
  let result: ReputationTier = 'NEW_CONTRIBUTOR';
  for (const t of TIERS) {
    if (points >= t.minPoints && reputation >= t.minReputation) result = t.tier;
  }
  return result;
}

export const tierIndex = (tier: ReputationTier) =>
  TIERS.findIndex((t) => t.tier === tier);

export function nextTier(tier: ReputationTier) {
  return TIERS[tierIndex(tier) + 1] ?? null;
}

// --------------------------------------------------------------- reputation

export const REPUTATION_VERSION = 'REPUTATION_V1';

export interface ReputationSignals {
  /** Reports the government verified (incl. later in progress/resolved). */
  verifiedReports: number;
  /** Reports the government rejected. */
  rejectedReports: number;
  /** Approved and rejected evidence the user submitted. */
  approvedEvidence: number;
  rejectedEvidence: number;
  /** Distinct resolved problems credited. */
  resolvedContributions: number;
  /** Distinct months with credited contributions in the last 12. */
  activeMonths: number;
}

/** Beta-smoothed rate: a prior of `mean` worth `strength` observations. */
export const smoothed = (
  successes: number,
  failures: number,
  mean: number,
  strength: number,
) => (successes + mean * strength) / (successes + failures + strength);

/**
 * An initial heuristic, 0–100 — **not** a validated measure of trust.
 *
 *   40%  report accuracy        verified / (verified + rejected), Beta(0.6, 3)
 *   20%  evidence acceptance    approved / (approved + rejected), Beta(0.6, 2)
 *   20%  successful outcomes    1 − e^(−resolved/5)
 *   20%  sustained participation  active months / 6, capped
 *
 * Priors keep a new account near the middle and stop a single event from
 * swinging the score; quantity enters only through saturating terms, so many
 * low-quality reports lower the score rather than raise it.
 */
export function reputationScore(s: ReputationSignals): number {
  const accuracy = smoothed(s.verifiedReports, s.rejectedReports, 0.6, 3);
  const evidence = smoothed(s.approvedEvidence, s.rejectedEvidence, 0.6, 2);
  const outcomes = 1 - Math.exp(-s.resolvedContributions / 5);
  const sustained = Math.min(1, s.activeMonths / 6);
  const score =
    100 * (0.4 * accuracy + 0.2 * evidence + 0.2 * outcomes + 0.2 * sustained);
  return Number(Math.min(100, Math.max(0, score)).toFixed(2));
}

// ------------------------------------------------------------------- badges

export interface BadgeInput {
  counts: Partial<Record<ImpactTransactionType, number>>;
  impactPoints: number;
  resolvedContributions: number;
  tier: ReputationTier;
}

export interface BadgeRule {
  key: string;
  name: string;
  description: string;
  criteria: string;
  earned: (input: BadgeInput) => boolean;
}

const n = (input: BadgeInput, ...types: ImpactTransactionType[]) =>
  types.reduce((sum, t) => sum + (input.counts[t] ?? 0), 0);

/** Badge definitions. Upserted into `badge_definitions` on start-up. */
export const BADGES: readonly BadgeRule[] = [
  {
    key: 'FIRST_REPORT',
    name: 'First Report',
    description: 'Your first report verified by a government office.',
    criteria: '1 verified report',
    earned: (i) => n(i, 'PROBLEM_VERIFIED') >= 1,
  },
  {
    key: 'COMMUNITY_HELPER',
    name: 'Community Helper',
    description: 'Early, substantive support on problems that were later resolved.',
    criteria: '3 community contributions to resolved problems',
    earned: (i) => n(i, 'USEFUL_COMMENT', 'PROBLEM_SUPPORTED') >= 3,
  },
  {
    key: 'DUPLICATE_DETECTOR',
    name: 'Duplicate Detector',
    description:
      'Helped keep reports clean by confirming duplicates of verified problems.',
    criteria: '3 confirmed duplicates',
    earned: (i) => n(i, 'DUPLICATE_IDENTIFIED') >= 3,
  },
  {
    key: 'CIVIC_CONTRIBUTOR',
    name: 'Civic Contributor',
    description: 'Reached 100 impact points.',
    criteria: '100 impact points',
    earned: (i) => i.impactPoints >= 100,
  },
  {
    key: 'PROJECT_CONTRIBUTOR',
    name: 'Project Contributor',
    description: 'Delivered work on resolution projects that were verified.',
    criteria: '3 credited project contributions',
    earned: (i) =>
      n(
        i,
        'TASK_COMPLETED',
        'MILESTONE_COMPLETED',
        'RESOLUTION_EVIDENCE_SUBMITTED',
        'PROJECT_CONTRIBUTION',
      ) >= 3,
  },
  {
    key: 'RESOLUTION_CHAMPION',
    name: 'Resolution Champion',
    description: 'Credited on five problems the government verified as resolved.',
    criteria: '5 resolved contributions',
    earned: (i) => i.resolvedContributions >= 5,
  },
  {
    key: 'CIVIC_CHAMPION',
    name: 'Civic Champion',
    description: 'Reached the Civic Champion tier.',
    criteria: 'Civic Champion tier',
    earned: (i) => tierIndex(i.tier) >= tierIndex('CIVIC_CHAMPION'),
  },
];

export function earnedBadges(input: BadgeInput): string[] {
  return BADGES.filter((b) => b.earned(input)).map((b) => b.key);
}
