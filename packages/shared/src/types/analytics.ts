import type { ProblemCategory, ProblemSeverity, ProblemStatus } from './problem.js';
import type { PriorityTier } from './priority.js';
import type { MapAggregateCell } from './geo.js';

/**
 * Civic analytics (Prompt 24): server-side aggregates over real records,
 * scoped to what the viewer may see — a government office's jurisdiction, an
 * organisation's own work, a citizen's own contributions.
 *
 * Every number is computed in PostgreSQL. Where there is too little data, a
 * value is `null` and the UI says "Not enough data yet" — never a fake zero.
 */

export const ANALYTICS_PRESETS = ['7d', '30d', '90d', '6m', '1y', 'custom'] as const;
export type AnalyticsPreset = (typeof ANALYTICS_PRESETS)[number];

export type AnalyticsGranularity = 'day' | 'week' | 'month';

export const ANALYTICS_DEFAULT_TIMEZONE = 'Asia/Kolkata';
/** The longest custom range accepted. */
export const ANALYTICS_MAX_RANGE_DAYS = 731;
/** Groups smaller than this are suppressed in area, hotspot and recurring views. */
export const ANALYTICS_MIN_GROUP_SIZE = 3;

/** The resolved period every response describes, in the reporting time zone. */
export interface AnalyticsPeriod {
  preset: AnalyticsPreset;
  /** Inclusive local dates, YYYY-MM-DD. */
  from: string;
  to: string;
  timezone: string;
  granularity: AnalyticsGranularity;
  /** The equal-length period immediately before, for comparisons. */
  previous: { from: string; to: string };
}

export interface AnalyticsFilters {
  category: ProblemCategory | null;
  severity: ProblemSeverity | null;
  status: ProblemStatus | null;
  priority: PriorityTier | null;
  city: string | null;
  /** A postal code — the finest area the platform records. */
  area: string | null;
}

interface Scoped {
  period: AnalyticsPeriod;
  filters: AnalyticsFilters;
  generatedAt: string;
}

/** A number with its definition key, so the UI can explain it. Null = not enough data. */
export interface MetricValue {
  key: string;
  value: number | null;
  /** The same metric over the previous period, when meaningful. */
  previous?: number | null;
  /** Relative change in %, or null when "Comparison unavailable". */
  changePct?: number | null;
}

// ---------------------------------------------------------------- overview

export interface AnalyticsOverview extends Scoped {
  metrics: {
    reported: MetricValue;
    verified: MetricValue;
    inProgress: MetricValue;
    resolved: MetricValue;
    rejected: MetricValue;
    criticalHigh: MetricValue;
    resolutionRate: MetricValue;
    avgDaysToVerification: MetricValue;
    medianDaysToVerification: MetricValue;
    avgDaysToResolution: MetricValue;
    medianDaysToResolution: MetricValue;
    /** Snapshot, not period-bound: problems open right now. */
    activeNow: MetricValue;
  };
}

// ------------------------------------------------------------------ trends

export interface TrendBucket {
  /** Local date the bucket starts on. */
  start: string;
  label: string;
  reported: number;
  verified: number;
  resolved: number;
  rejected: number;
}

export interface AnalyticsTrends extends Scoped {
  granularity: AnalyticsGranularity;
  buckets: TrendBucket[];
}

// -------------------------------------------------------------- categories

export interface CategoryRow {
  category: ProblemCategory;
  count: number;
  /** Share of all problems in the period, 0–100. */
  share: number;
  previous: number;
  /** Null: "Comparison unavailable" (too few in the previous period). */
  changePct: number | null;
  direction: 'increasing' | 'decreasing' | 'stable' | 'unknown';
  /** Reported in at least three quarters of the period's buckets. */
  persistent: boolean;
}

export interface AnalyticsCategories extends Scoped {
  total: number;
  categories: CategoryRow[];
  subcategories: Array<{ category: ProblemCategory; subcategory: string; count: number; share: number }>;
  severity: Array<{ severity: ProblemSeverity; count: number; share: number }>;
  priority: Array<{ tier: PriorityTier | 'UNASSESSED'; count: number; share: number }>;
}

// ------------------------------------------------------------------- areas

export interface AreaRow {
  name: string;
  /** Null when suppressed (fewer than the minimum group size). */
  count: number | null;
  open: number | null;
  resolved: number | null;
  suppressed: boolean;
}

export interface AnalyticsAreas extends Scoped {
  /** The whole jurisdiction, for context. */
  jurisdiction: { name: string; type: string; count: number };
  byState: AreaRow[];
  byCity: AreaRow[];
  /** Postal codes — the finest area recorded. */
  byPostalCode: AreaRow[];
  minGroupSize: number;
}

// -------------------------------------------------------------- resolution

export interface FunnelStage {
  key: 'submitted' | 'review' | 'verified' | 'allocated' | 'inProgress' | 'resolved';
  label: string;
  count: number;
  /** Share of the previous stage, 0–100; null for the first or when the previous is 0. */
  conversionPct: number | null;
}

export interface StageDuration {
  key: 'review' | 'verification' | 'allocation' | 'acceptance' | 'execution';
  label: string;
  /** Average and median days; null with fewer than the minimum observations. */
  avgDays: number | null;
  medianDays: number | null;
  observations: number;
}

export interface AnalyticsResolution extends Scoped {
  summary: {
    avgDays: number | null;
    medianDays: number | null;
    fastestDays: number | null;
    /** Days the oldest currently open problem has waited. */
    longestOpenDays: number | null;
    resolutionRate: number | null;
    /** Verification requests the office rejected or returned for more evidence. */
    returnedVerifications: number;
  };
  funnel: FunnelStage[];
  stages: StageDuration[];
  /** The stage with the longest observed average — not a cause. */
  bottleneck: { key: StageDuration['key']; label: string; avgDays: number } | null;
  distribution: Array<{ bucket: string; count: number }>;
  byPriority: Array<{ tier: PriorityTier | 'UNASSESSED'; count: number; resolved: number; resolutionRate: number | null; medianDays: number | null; openNow: number }>;
  bySeverity: Array<{ severity: ProblemSeverity; count: number; resolved: number; resolutionRate: number | null; medianDays: number | null }>;
}

// --------------------------------------------------------------- community

export interface AnalyticsCommunity extends Scoped {
  activeContributors: number;
  reported: number;
  verifiedReports: number;
  confirmedDuplicates: number;
  communitySupported: number;
  contributionsToResolution: number;
  impactPointsEarned: number;
  outcome: {
    reports: number;
    verified: number;
    resolved: number;
    avgDaysReportToVerification: number | null;
    avgDaysVerificationToResolution: number | null;
  };
}

// ---------------------------------------------------------------- hotspots

export interface HotspotCell {
  /** Grid cell id (stable for the cell size). */
  id: string;
  /** Rounded centroid — never an exact report location. */
  latitude: number;
  longitude: number;
  label: string | null;
  problemCount: number;
  openCount: number;
  severityScore: number;
  /** Weighted problems per km². */
  density: number;
  /** Standard deviations above the mean density of occupied cells. */
  zScore: number;
  isHotspot: boolean;
  confidence: number;
  topCategory: ProblemCategory | null;
}

export interface AnalyticsHotspots extends Scoped {
  algorithmVersion: string;
  cellSizeKm: number;
  /** Map cells, in the existing aggregate shape the map draws. */
  cells: MapAggregateCell[];
  hotspots: HotspotCell[];
  occupiedCells: number;
  note: string | null;
}

export interface RecurringCluster {
  category: ProblemCategory;
  area: string | null;
  reports: number;
  distinctReporters: number;
  firstReported: string;
  lastReported: string;
  spanDays: number;
  open: number;
  latitude: number;
  longitude: number;
}

export interface AnalyticsRecurring extends Scoped {
  algorithmVersion: string;
  clusters: RecurringCluster[];
}

// ---------------------------------------------------------------- insights

export interface AnalyticsInsightView {
  /** Observed data: the computed facts the summary was allowed to use. */
  facts: Array<{ key: string; label: string; value: string }>;
  /** AI interpretation of those facts — each statement cites fact keys. */
  summary: string;
  observations: Array<{ text: string; metricKeys: string[] }>;
  attention: Array<{ text: string; metricKeys: string[] }>;
  /** Reference knowledge (public guidance), kept apart from the data. */
  guidance: Array<{ ref: string; title: string; sectionTitle: string | null; href: string }>;
  guidanceNotes: Array<{ text: string; refs: string[] }>;
  model: { provider: string; name: string; promptVersion: string; aiRan: boolean };
  generatedAt: string;
  period: AnalyticsPeriod;
  filters: AnalyticsFilters;
}

export type AnalyticsExportDataset =
  | 'overview'
  | 'trends'
  | 'categories'
  | 'areas'
  | 'resolution'
  | 'problems';
export const ANALYTICS_EXPORT_DATASETS: readonly AnalyticsExportDataset[] = [
  'overview',
  'trends',
  'categories',
  'areas',
  'resolution',
  'problems',
];

// ------------------------------------------------------------ organisation

export interface OrganizationAnalytics extends Omit<Scoped, 'filters'> {
  problemsAssigned: number;
  projectsActive: number;
  projectsCompleted: number;
  avgCompletionDays: number | null;
  onTimeRate: number | null;
  onTimeObservations: number;
  tasksCompleted: number;
  openTasks: number;
  evidenceSubmitted: number;
  evidenceApprovalRate: number | null;
  governmentApprovals: number;
  trend: Array<{ start: string; label: string; tasksCompleted: number; projectsCompleted: number }>;
}

// ----------------------------------------------------------------- citizen

export interface CitizenAnalytics {
  reported: number;
  verified: number;
  resolved: number;
  inProgress: number;
  awaitingReview: number;
  confirmedDuplicates: number;
  medianDaysToResolution: number | null;
  supportersOnMyReports: number;
  impactPoints: number;
  generatedAt: string;
}

// ------------------------------------------------------------- definitions

/** Every metric, defined once — shown as help text and documented. */
export const METRIC_DEFINITIONS: Record<string, { label: string; definition: string }> = {
  reported: { label: 'Problems reported', definition: 'Non-draft problems reported in the period (by report date, reporting time zone).' },
  verified: { label: 'Verified', definition: 'Of the problems reported in the period, those a government office has verified (now verified, in progress or resolved).' },
  inProgress: { label: 'In progress', definition: 'Of the problems reported in the period, those an organisation is working on now.' },
  resolved: { label: 'Resolved', definition: 'Of the problems reported in the period, those a government office has approved as resolved.' },
  rejected: { label: 'Rejected', definition: 'Of the problems reported in the period, those a government office did not accept.' },
  criticalHigh: { label: 'Critical / high priority', definition: 'Of the problems reported in the period, those whose effective priority (an official’s override, else the AI tier) is Critical or High.' },
  resolutionRate: { label: 'Resolution rate', definition: 'Resolved ÷ verified, among problems reported in the period. Unavailable when none were verified.' },
  avgDaysToVerification: { label: 'Average time to verification', definition: 'Mean days from report to the first government verification, for problems reported in the period that were verified.' },
  medianDaysToVerification: { label: 'Median time to verification', definition: 'Median of the same durations — less affected by outliers.' },
  avgDaysToResolution: { label: 'Average resolution time', definition: 'Mean days from report to government-approved resolution, for problems reported in the period that were resolved.' },
  medianDaysToResolution: { label: 'Median resolution time', definition: 'Median of the same durations.' },
  activeNow: { label: 'Active now', definition: 'Problems open right now (submitted, under review, verified or in progress), regardless of period.' },
  fastestDays: { label: 'Fastest resolution', definition: 'The shortest report-to-resolution time among problems reported in the period.' },
  longestOpenDays: { label: 'Longest waiting', definition: 'Days the oldest problem that is still open has waited since it was reported (a snapshot, regardless of period).' },
  returnedVerifications: { label: 'Resolutions returned', definition: 'Resolution verification requests the office rejected or returned for more evidence, decided in the period.' },
  activeContributors: { label: 'Active contributors', definition: 'Distinct people credited with impact points for problems in the jurisdiction during the period.' },
  verifiedReports: { label: 'Verified reports', definition: 'Reports from the period that a government office verified.' },
  confirmedDuplicates: { label: 'Confirmed duplicates', definition: 'Reports from the period confirmed as duplicates of an earlier report.' },
  communitySupported: { label: 'Community-supported', definition: 'Reports from the period with at least one supporter.' },
  contributionsToResolution: { label: 'Contributions to resolution', definition: 'Credited contributions (reports, support, comments, project work) to problems resolved, awarded in the period.' },
  avgDaysReportToVerification: { label: 'Report to verification', definition: 'Mean days from report to first verification, for reports from the period.' },
  projectsCompleted: { label: 'Projects completed', definition: 'Projects your organisation completed in the period.' },
  projectsActive: { label: 'Active projects', definition: 'Planned, active or paused projects right now.' },
  avgCompletionDays: { label: 'Average project duration', definition: 'Mean days from start (or creation) to completion, for projects completed in the period. Needs three.' },
  onTimeRate: { label: 'On-time completion', definition: 'Of projects completed in the period that had a target date, the share completed on or before it. Needs three.' },
  evidenceApprovalRate: { label: 'Evidence approval rate', definition: 'Approved ÷ (approved + rejected) evidence decided in the period. Needs three decisions.' },
  tasksCompleted: { label: 'Tasks completed', definition: 'Project tasks completed in the period.' },
  openTasks: { label: 'Open tasks', definition: 'To-do, in-progress or blocked tasks on live projects right now — your current workload.' },
  problemsAssigned: { label: 'Problems accepted', definition: 'Allocations your organisation accepted in the period.' },
  governmentApprovals: { label: 'Resolutions approved', definition: 'Resolution requests a government office approved for your projects in the period.' },
  changePct: { label: 'Change', definition: '(This period − previous period) ÷ previous period. The previous period has the same length and ends where this one starts. Unavailable when the previous period has fewer than 5.' },
};
