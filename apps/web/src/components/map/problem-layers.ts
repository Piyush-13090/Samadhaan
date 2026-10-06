import type {
  CircleLayerSpecification,
  GeoJSONSourceSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { MAP_COLORS, SEVERITY_MARKERS } from '@/lib/map/severity-markers';

/**
 * ProblemMarker and ProblemMarkerCluster, as map layers.
 *
 * Plain data — style-spec objects — so they can be tested without a GPU, and
 * so a future adapter for another GL library can read the same intent. Types
 * only are imported from MapLibre; nothing here runs it.
 */

export const PROBLEMS = 'problems';

/**
 * One GeoJSON source for every visible problem, clustered by the library
 * (supercluster, in a web worker). Clustering stops at street level, past which
 * every problem stands alone.
 */
export const PROBLEM_SOURCE: GeoJSONSourceSpecification = {
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] },
  cluster: true,
  clusterRadius: 48,
  clusterMaxZoom: 15,
  promoteId: 'publicId',
};

/** ProblemMarkerCluster: a bubble sized by how many problems it holds. */
export const PROBLEM_CLUSTER_LAYER: CircleLayerSpecification = {
  id: 'problem-clusters',
  type: 'circle',
  source: PROBLEMS,
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': MAP_COLORS.cluster,
    'circle-opacity': 0.9,
    'circle-stroke-color': MAP_COLORS.outline,
    'circle-stroke-width': 2,
    'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26, 200, 32],
  },
};

/** The count on a cluster — "47". */
export const PROBLEM_CLUSTER_COUNT_LAYER: SymbolLayerSpecification = {
  id: 'problem-cluster-count',
  type: 'symbol',
  source: PROBLEMS,
  filter: ['has', 'point_count'],
  layout: {
    'text-field': ['get', 'point_count_abbreviated'],
    'text-size': 13,
    'text-allow-overlap': true,
  },
  paint: { 'text-color': MAP_COLORS.clusterText },
};

/** A ring under the selected problem, so its shape stays legible. */
export const PROBLEM_SELECTED_LAYER: CircleLayerSpecification = {
  id: 'problem-selected',
  type: 'circle',
  source: PROBLEMS,
  filter: ['==', ['get', 'publicId'], ''],
  paint: {
    'circle-radius': 18,
    'circle-color': MAP_COLORS.selection,
    'circle-opacity': 0.18,
    'circle-stroke-color': MAP_COLORS.selection,
    'circle-stroke-width': 2,
  },
};

/** ProblemMarker: each severity's shape, the most severe drawn on top. */
export const PROBLEM_MARKER_LAYER: SymbolLayerSpecification = {
  id: 'problem-points',
  type: 'symbol',
  source: PROBLEMS,
  filter: ['!', ['has', 'point_count']],
  layout: {
    'icon-image': [
      'match',
      ['get', 'severity'],
      'CRITICAL',
      SEVERITY_MARKERS.CRITICAL.icon,
      'HIGH',
      SEVERITY_MARKERS.HIGH.icon,
      'MEDIUM',
      SEVERITY_MARKERS.MEDIUM.icon,
      SEVERITY_MARKERS.LOW.icon,
    ],
    'icon-size': ['match', ['get', 'severity'], 'CRITICAL', 1.15, 'HIGH', 1.05, 0.95],
    'icon-allow-overlap': true,
    'symbol-sort-key': [
      'match',
      ['get', 'severity'],
      'CRITICAL',
      4,
      'HIGH',
      3,
      'MEDIUM',
      2,
      1,
    ],
  },
};
