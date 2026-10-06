import type {
  AiStatusFilter,
  DuplicateFilter,
  GovernmentStatusFilter,
  BoundingBox,
  GeocodeResult,
  MapAggregateCollection,
  MapFilterStatus,
  MapProblemCollection,
  ProblemCategory,
  ProblemSeverity,
} from '@samadhaan/shared';
import { api } from '@/lib/api';
import type { LatLng } from '@/lib/map/types';

export interface MapFilters {
  category?: ProblemCategory;
  severity?: ProblemSeverity;
  /** The public map takes the five citizen-facing statuses; the government map, any but DRAFT. */
  status?: MapFilterStatus | GovernmentStatusFilter;
  // Government map only.
  duplicate?: DuplicateFilter;
  aiStatus?: AiStatusFilter;
  reportedWithinDays?: 7 | 30 | 90;
}

/**
 * Where viewport queries go. The public map by default; the government map
 * passes its office's endpoints, where the API applies the jurisdiction.
 */
export interface MapSource {
  problems: string;
  aggregate: string;
}

export const PUBLIC_MAP_SOURCE: MapSource = {
  problems: '/problems/map',
  aggregate: '/problems/map/aggregate',
};

function boxQuery(bbox: BoundingBox) {
  const [west, south, east, north] = bbox.map((value) => Number(value.toFixed(6)));
  return { west, south, east, north };
}

/** Problems in a viewport. Public; the origin only measures distance. */
export function fetchMapProblems(
  bbox: BoundingBox,
  filters: MapFilters,
  options: {
    origin?: LatLng | null;
    limit?: number;
    signal?: AbortSignal;
    source?: MapSource;
  } = {},
): Promise<MapProblemCollection> {
  return api.get<MapProblemCollection>((options.source ?? PUBLIC_MAP_SOURCE).problems, {
    query: {
      ...boxQuery(bbox),
      ...filters,
      limit: options.limit,
      originLatitude: options.origin?.latitude,
      originLongitude: options.origin?.longitude,
    },
    signal: options.signal,
  });
}

/** Aggregated cells, for viewports too large for individual problems. */
export function fetchMapAggregate(
  bbox: BoundingBox,
  filters: MapFilters,
  options: { signal?: AbortSignal; source?: MapSource } = {},
): Promise<MapAggregateCollection> {
  return api.get<MapAggregateCollection>(
    (options.source ?? PUBLIC_MAP_SOURCE).aggregate,
    {
      query: { ...boxQuery(bbox), ...filters },
      signal: options.signal,
    },
  );
}

/** Place search, through the API — the browser never calls the geocoder. */
export function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  return api.get<GeocodeResult[]>('/geo/search', { query: { q: query }, signal });
}

export function reverseGeocode(position: LatLng): Promise<GeocodeResult | null> {
  return api.get<GeocodeResult | null>('/geo/reverse', {
    query: { latitude: position.latitude, longitude: position.longitude },
  });
}
