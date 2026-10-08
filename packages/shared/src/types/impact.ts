import type { ProblemCategory } from './problem.js';

/**
 * Impact points, reputation and badges (Prompt 23).
 *
 * **Impact points** are the quantity of recognised civic contribution: an
 * append-only ledger, awarded by the server for confirmed outcomes — a report
 * the government verified, a duplicate confirmed, a problem resolved — never
 * for raw activity. **Reputation** (0–100) is a separate, initial heuristic of
 * contribution *quality*; it is not a validated measure of trustworthiness.
 */

export const IMPACT_TRANSACTION_TYPES = [
  'PROBLEM_REPORTED',
  'PROBLEM_VERIFIED',
  'DUPLICATE_IDENTIFIED',
  'USEFUL_COMMENT',
  'PROBLEM_SUPPORTED',
  'PROJECT_CONTRIBUTION',
  'TASK_COMPLETED',
  'MILESTONE_COMPLETED',
  'RESOLUTION_EVIDENCE_SUBMITTED',
  'PROBLEM_RESOLVED',
  'QUALITY_BONUS',
  'PENALTY',
  'ADMIN_ADJUSTMENT',
] as const;
export type ImpactTransactionType = (typeof IMPACT_TRANSACTION_TYPES)[number];

/** History filters, as the profile page groups them. */
export const IMPACT_FILTERS = ['all', 'reports', 'community', 'projects', 'resolutions', 'bonuses'] as const;
export type ImpactFilter = (typeof IMPACT_FILTERS)[number];

export const IMPACT_FILTER_TYPES: Record<Exclude<ImpactFilter, 'all'>, readonly ImpactTransactionType[]> = {
  reports: ['PROBLEM_REPORTED', 'PROBLEM_VERIFIED', 'DUPLICATE_IDENTIFIED'],
  community: ['USEFUL_COMMENT', 'PROBLEM_SUPPORTED'],
  projects: ['PROJECT_CONTRIBUTION', 'TASK_COMPLETED', 'MILESTONE_COMPLETED', 'RESOLUTION_EVIDENCE_SUBMITTED'],
  resolutions: ['PROBLEM_RESOLVED'],
  bonuses: ['QUALITY_BONUS', 'PENALTY', 'ADMIN_ADJUSTMENT'],
};

export const REPUTATION_TIERS = [
  'NEW_CONTRIBUTOR',
  'ACTIVE_CONTRIBUTOR',
  'TRUSTED_CONTRIBUTOR',
  'CIVIC_CHAMPION',
  'CIVIC_LEADER',
] as const;
export type ReputationTier = (typeof REPUTATION_TIERS)[number];

export const LEADERBOARD_PERIODS = ['week', 'month', 'year', 'all'] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export const IMPACT_ADJUSTMENT_MAX = 1000;

export interface ImpactTransactionView {
  id: string;
  amount: number;
  type: ImpactTransactionType;
  reason: string;
  /** The problem it concerns, when there is one (public reference only). */
  problem: { publicId: string; title: string } | null;
  ruleVersion: string;
  createdAt: string;
}

/** `GET /users/me/impact` */
export interface ImpactSummary {
  impactPoints: number;
  resolvedContributions: number;
  tier: ReputationTier;
  items: ImpactTransactionView[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

/** `GET /users/me/reputation` — public signals only; never internal negatives. */
export interface ReputationView {
  score: number;
  tier: ReputationTier;
  /** The next tier and what it needs, or null at the top. */
  next: { tier: ReputationTier; pointsNeeded: number; minimumReputation: number } | null;
  impactPoints: number;
  verifiedReports: number;
  successfulContributions: number;
  resolvedContributions: number;
  updatedAt: string | null;
  /** States plainly that this is an initial heuristic. */
  note: string;
}

export interface BadgeView {
  key: string;
  name: string;
  description: string;
  criteria: string;
  earned: boolean;
  awardedAt: string | null;
}

export interface ContributionView {
  problem: { publicId: string; title: string; category: ProblemCategory; city: string | null };
  /** Kinds of credit received for it. */
  roles: ImpactTransactionType[];
  points: number;
  resolvedAt: string | null;
}

export interface LeaderboardEntryView {
  rank: number;
  user: { displayName: string | null; name: string; avatarUrl: string | null };
  impactPoints: number;
  reputationScore: number;
  reputationTier: ReputationTier;
  resolvedContributions: number;
  badges: Array<{ key: string; name: string }>;
  isViewer: boolean;
}

/** `GET /leaderboard` */
export interface LeaderboardPage {
  period: LeaderboardPeriod;
  filters: { city: string | null; state: string | null; category: ProblemCategory | null };
  items: LeaderboardEntryView[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  /** The signed-in viewer's own position under these filters, when ranked. */
  viewer: LeaderboardEntryView | null;
  generatedAt: string;
}
