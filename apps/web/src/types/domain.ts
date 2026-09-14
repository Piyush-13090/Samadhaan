/**
 * Domain vocabulary for the Samadhaan UI layer.
 *
 * The enums now come from `@samadhaan/shared`, which mirrors the Prisma schema
 * — the database is the single source of truth for the vocabulary. What stays
 * here are the *view shapes*: what a card or a panel needs to render, which is
 * not the same as what a table stores.
 *
 * When the problem endpoints land, a mapper converts API responses into these
 * and no component changes.
 */

export type {
  ProblemStatus,
  ProblemSeverity,
  ProblemUrgency,
  ProblemCategory,
  OrganizationType,
  ProblemImageKind,
  SuggestionStatus,
} from '@samadhaan/shared';

export {
  PROBLEM_STATUSES,
  PROBLEM_SEVERITIES,
  PROBLEM_URGENCIES,
  PROBLEM_CATEGORIES,
  ACTIVE_PROBLEM_STATUSES,
} from '@samadhaan/shared';

import type {
  ProblemCategory,
  ProblemSeverity,
  ProblemStatus,
  OrganizationType,
} from '@samadhaan/shared';

/** Triage priority assigned in the government workspace. */
export const PRIORITY_LEVELS = ['P1', 'P2', 'P3', 'P4'] as const;

export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

/**
 * Display alias kept for existing components: severity bands and the AI's
 * severity vocabulary are the same set.
 */
export type SeverityLevel = ProblemSeverity;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface ProblemLocation extends GeoPoint {
  /** Human-readable address shown to users. */
  address: string;
  /** Area or ward name, used for grouping and filters. */
  area?: string;
  /** Distance from the viewer in metres, when a viewer location is known. */
  distanceMeters?: number;
}

export interface PersonSummary {
  id: string;
  name: string;
  /** Remote avatar URL. Absent means the UI renders initials. */
  avatarUrl?: string;
  /** Organisation name, when this person acts on behalf of one. */
  organization?: string;
}

/** AI-produced analysis of a problem. Always carries its own confidence. */
export interface AiAnalysis {
  category: ProblemCategory;
  /** 0–10, one decimal. Displayed alongside its band, never alone. */
  severityScore: number;
  severity: SeverityLevel;
  /** 0–1. Rendered as a percentage with a confidence meter. */
  confidence: number;
  /** Short human-readable sentences describing what the AI observed. */
  observations: string[];
  /** Number of possible duplicate reports found, if the check has run. */
  duplicateCandidates?: number;
}

export interface ProblemSummary {
  id: string;
  /** Public reference, e.g. `SAM-1023`. Rendered in the mono face. */
  reference: string;
  title: string;
  description: string;
  status: ProblemStatus;
  severity: SeverityLevel;
  category: ProblemCategory;
  location: ProblemLocation;
  reporter: PersonSummary;
  supporterCount: number;
  commentCount: number;
  suggestionCount: number;
  /** ISO-8601. Formatted for display by `lib/format.ts`. */
  reportedAt: string;
  /** Completion percentage, present once work has started. */
  progress?: number;
  ai?: AiAnalysis;
  /** Organisations working on this problem. */
  assignedTo?: OrganizationSummary[];
}

/** Alias for the shared organisation type. */
export type OrganizationKind = OrganizationType;

export interface OrganizationSummary {
  id: string;
  name: string;
  kind: OrganizationKind;
  logoUrl?: string;
  /** Verified organisations show a verification mark. */
  verified: boolean;
  /** Capability tags used for problem matching. */
  focusAreas: string[];
  problemsResolved: number;
  /** Area the organisation serves, for display. */
  serviceArea?: string;
}

export interface SuggestionSummary {
  id: string;
  author: PersonSummary;
  content: string;
  endorsements: number;
  createdAt: string;
  /** Marked by government as the approach being taken. */
  accepted?: boolean;
}

export interface CommentSummary {
  id: string;
  author: PersonSummary;
  content: string;
  createdAt: string;
  replyCount?: number;
}

export interface TimelineEvent {
  id: string;
  title: string;
  description?: string;
  timestamp: string;
  /** Drives the marker treatment on the timeline. */
  state: 'complete' | 'current' | 'upcoming';
  /** Set when the event was produced by AI rather than a person. */
  byAi?: boolean;
  actor?: string;
}

export interface LeaderboardEntry {
  rank: number;
  person: PersonSummary;
  impactPoints: number;
  problemsReported: number;
  problemsResolved: number;
  /** Rank movement since the previous period. */
  trend?: number;
}

export type NotificationKind =
  | 'PROBLEM_UPDATE'
  | 'AI_ANALYSIS'
  | 'COMMENT'
  | 'SUGGESTION'
  | 'ALLOCATION'
  | 'RESOLUTION';

export interface NotificationSummary {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  /** Where clicking the notification should navigate. */
  href?: string;
}

export interface ImpactStat {
  id: string;
  label: string;
  value: number;
  /** Suffix such as `pts`, or a unit. */
  unit?: string;
  /** Percentage change against the previous period. */
  change?: number;
  hint?: string;
  /**
   * Marks a metric whose underlying system does not exist yet.
   *
   * Rendered as a dash rather than a number. A zero here would read as a
   * measured score of nothing, which is a different and wrong claim — see
   * `impactPoints`, which stays null until the ledger is built.
   */
  pending?: boolean;
}
