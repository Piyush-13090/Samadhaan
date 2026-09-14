import type {
  ProblemCategory,
  ProblemSeverity,
  ProblemStatus,
  ProblemUrgency,
} from './problem.js';
import type { ProfileActivity } from './profile.js';

/**
 * Problem discovery contracts — the citizen dashboard and the explore feed.
 *
 * These are read models, deliberately narrower than `ProblemView`. A feed shows
 * many problems belonging to many people, so it carries the *civic* facts and
 * nothing about who filed them: no reporter object, no internal UUID, no
 * coordinates. `publicId` is the identity a citizen can act on.
 */

/** How far a discovery search reaches, in metres. */
export const DISTANCE_OPTIONS = [1000, 5000, 10_000, 25_000] as const;

export type DistanceOption = (typeof DISTANCE_OPTIONS)[number];

/** Largest radius the API will accept. Beyond this, "nearby" means nothing. */
export const MAX_DISCOVERY_RADIUS_METERS = 50_000;

export const DEFAULT_DISCOVERY_RADIUS_METERS = 5000;

/** How a discovery feed is ordered. */
export const DISCOVERY_SORTS = ['relevance', 'distance', 'recent', 'severity'] as const;

export type DiscoverySort = (typeof DISCOVERY_SORTS)[number];

/**
 * One problem in a feed.
 *
 * Everything here is public civic information. Notably absent, and not by
 * omission: the reporter, the internal id, and the exact coordinates.
 */
export interface ProblemListItem {
  /** The public reference, e.g. `SAM-1023`. The only identity a feed exposes. */
  publicId: string;
  title: string;
  category: ProblemCategory;
  subcategory: string | null;
  status: ProblemStatus;
  severity: ProblemSeverity;
  urgency: ProblemUrgency;

  /** Coarse locality only — never the street address or coordinates. */
  area: string | null;
  city: string | null;

  /** Metres from the search origin. Null when the search had no origin. */
  distanceMeters: number | null;

  voteCount: number;
  commentCount: number;
  /** Primary image, when the report has one. */
  thumbnailUrl: string | null;
  createdAt: string;

  /** Whether an AI analysis completed, so the card can mark it. */
  hasAiAnalysis: boolean;
  /** True when the viewer filed this report. Absent for anonymous viewers. */
  isOwnReport?: boolean;
}

/** Where a discovery search was centred. */
export interface DiscoveryOrigin {
  kind: 'coordinates' | 'city' | 'none';
  /** Human-readable, e.g. "Sector 12, Gurugram". Null when unknown. */
  label: string | null;
  /** Radius actually applied, in metres. Null for a city search. */
  radiusMeters: number | null;
}

export interface ProblemFeed {
  items: ProblemListItem[];
  nextCursor: string | null;
  /** Echoes how the search was resolved, so the UI can label it honestly. */
  origin: DiscoveryOrigin;
}

/**
 * Everything the citizen dashboard needs, in one response.
 *
 * Deliberately one endpoint rather than four: a dashboard that fans out to a
 * request per section is slow on exactly the connection a civic app is used on.
 * Nearby problems are *not* included — they depend on a location the browser
 * only knows client-side, so they are fetched separately once it is available.
 */
export interface CitizenDashboard {
  user: {
    name: string;
    /** The name to greet with — the first word of the display name. */
    firstName: string;
    /** Coarse home locality from the profile, used as a location fallback. */
    city: string | null;
    state: string | null;
  };
  /** Real counts. `impactPoints` stays null until the ledger exists. */
  activity: ProfileActivity;
  /** The citizen's most recent reports, newest first. */
  recentReports: ProblemListItem[];
  /** Total reports filed, so "view all" can show a count. */
  reportCount: number;
}

/**
 * Weights for the discovery ranking.
 *
 * Exported so the UI can explain the ordering and the API can apply it, from
 * one definition. Transparent and hand-chosen — this is basic discovery
 * ranking, not the AI priority engine, which is a later milestone.
 */
export const DISCOVERY_RANKING = {
  proximity: 0.45,
  severity: 0.25,
  recency: 0.2,
  support: 0.1,
  /** Days after which the recency contribution halves. */
  recencyHalfLifeDays: 14,
  /** Vote count at which the support signal saturates. */
  supportSaturation: 50,
} as const;
