/**
 * Domain vocabulary for the Samadhaan UI layer.
 *
 * These are the shapes the presentational components render. They intentionally
 * describe *what the UI needs*, not the database schema — when the API lands,
 * a mapper converts API responses into these, and no component changes.
 *
 * Roles and platform enums that cross the service boundary live in
 * `@samadhaan/shared`; these are UI-only.
 */

/** Lifecycle of a reported problem, in the order it progresses. */
export const PROBLEM_STATUSES = [
  'OPEN',
  'UNDER_REVIEW',
  'ALLOCATED',
  'IN_PROGRESS',
  'RESOLVED',
  'REJECTED',
] as const;

export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

/** Severity band. The numeric AI score maps onto one of these for display. */
export const SEVERITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

/** Problem categories. Mirrors the taxonomy the AI classifier will produce. */
export const PROBLEM_CATEGORIES = [
  'ROAD',
  'WATER',
  'SANITATION',
  'ELECTRICITY',
  'SAFETY',
  'ENVIRONMENT',
  'PUBLIC_INFRASTRUCTURE',
] as const;

export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

/** Triage priority assigned in the government workspace. */
export const PRIORITY_LEVELS = ['P1', 'P2', 'P3', 'P4'] as const;

export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

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

export type OrganizationKind = 'NGO' | 'UNIVERSITY' | 'INDUSTRY' | 'GOVERNMENT';

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
}
