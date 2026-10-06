import type { ProblemCategory, ProblemSeverity, ProblemStatus } from './problem.js';

/**
 * Geospatial contracts — the civic map, its aggregation layer, and geocoding.
 *
 * Coordinates are WGS 84 (SRID 4326), and GeoJSON order is always
 * `[longitude, latitude]`. Everything a map shows is a *problem's* civic
 * location — never a reporter's, and never a profile's.
 */

/** `[west, south, east, north]` in degrees. */
export type BoundingBox = [number, number, number, number];

/**
 * Largest viewport, in degrees on either axis, for which individual problems
 * are returned. Roughly 165 km of latitude — a metropolitan region. Beyond it
 * the map switches to aggregated cells, so no request can ask for a country's
 * worth of rows.
 */
export const MAP_DETAIL_MAX_SPAN_DEGREES = 1.5;

/** Largest viewport the aggregation endpoint accepts — roughly India's extent. */
export const MAP_AGGREGATE_MAX_SPAN_DEGREES = 40;

export const MAP_FEATURE_DEFAULT_LIMIT = 500;
export const MAP_FEATURE_MAX_LIMIT = 1000;

/** Statuses a citizen can filter the map by. Drafts and internal outcomes are never shown. */
export const MAP_FILTER_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'IN_PROGRESS',
  'RESOLVED',
] as const satisfies readonly ProblemStatus[];

export type MapFilterStatus = (typeof MAP_FILTER_STATUSES)[number];

// ---------------------------------------------------------------------------
// Problems on the map
// ---------------------------------------------------------------------------

/**
 * One problem as a map marker. Public civic facts only — the same rule as a
 * feed card: no reporter, no internal id.
 */
export interface MapProblemProperties {
  publicId: string;
  title: string;
  category: ProblemCategory;
  subcategory: string | null;
  severity: ProblemSeverity;
  status: ProblemStatus;
  /** Coarse locality: the first address segment, or the city. */
  area: string | null;
  city: string | null;
  voteCount: number;
  createdAt: string;
  /** Metres from `origin`, measured by PostGIS. Null when no origin was given. */
  distanceMeters: number | null;
}

export interface MapProblemFeature {
  type: 'Feature';
  /** The public id, so a map library can track selection by it. */
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: MapProblemProperties;
}

export interface MapProblemCollection {
  type: 'FeatureCollection';
  features: MapProblemFeature[];
  /** The viewport the server actually queried. */
  bbox: BoundingBox;
  /** True when more problems matched than `limit` allowed; the most severe were kept. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Aggregation — the hotspot foundation
// ---------------------------------------------------------------------------

export interface MapAggregateCellProperties {
  count: number;
  severity: Record<ProblemSeverity, number>;
  /** Up to three categories, most frequent first. */
  topCategories: Array<{ category: ProblemCategory; count: number }>;
}

export interface MapAggregateCell {
  type: 'Feature';
  /** The centroid of the problems in the cell, not the cell's corner. */
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: MapAggregateCellProperties;
}

export interface MapAggregateCollection {
  type: 'FeatureCollection';
  features: MapAggregateCell[];
  bbox: BoundingBox;
  /** Grid size the server chose for this viewport, in degrees. */
  cellSizeDegrees: number;
  /** Problems across every cell. */
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

export interface GeocodeResult {
  /** Human-readable, e.g. "Sector 12, Gurugram, Haryana". */
  label: string;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  /** The place's extent, when the provider knows it — lets the map fit a city. */
  boundingBox: BoundingBox | null;
}
