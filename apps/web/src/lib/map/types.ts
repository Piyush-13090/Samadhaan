import type { BoundingBox, MapAggregateCell, MapProblemFeature } from '@samadhaan/shared';

/**
 * The contract between Samadhaan and whichever map library draws the map.
 *
 * Everything outside `components/map/<provider>/` speaks only these types. A
 * provider adapter is a React component taking `MapAdapterProps`; swapping
 * MapLibre for Google Maps or Leaflet means writing one more adapter and
 * selecting it in `civic-map.tsx`. Nothing that uses a map changes.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** What is on screen. Reported after movement settles, never during a drag. */
export interface MapViewport {
  bbox: BoundingBox;
  zoom: number;
  center: LatLng;
}

/** Imperative handle, for controls that live outside the map. */
export interface MapController {
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (center: LatLng, zoom?: number) => void;
  fitBounds: (bbox: BoundingBox) => void;
  getViewport: () => MapViewport;
}

export interface MapAdapterProps {
  /** Opening view. Later changes go through the controller. */
  initialCenter: LatLng;
  initialZoom: number;
  /** Individual problems. Clustered by the adapter. */
  problems?: MapProblemFeature[];
  /** Aggregated cells, shown instead of problems when zoomed far out. */
  aggregates?: MapAggregateCell[];
  selectedId?: string | null;
  onSelect?: (publicId: string | null) => void;
  /** An aggregate cell was chosen; the caller zooms in. */
  onAggregateSelect?: (cell: MapAggregateCell) => void;
  onViewportChange?: (viewport: MapViewport) => void;
  onReady?: (controller: MapController) => void;
  /** The provider failed to start — no WebGL, style unreachable. */
  onError?: (message: string) => void;
  /** The viewer's chosen location, shown as a dot. Never sent anywhere. */
  userLocation?: LatLng | null;
  /** A single draggable pin, for choosing a location. */
  pin?: LatLng | null;
  onPinChange?: (position: LatLng) => void;
  /** Renders the popup for the selected problem. */
  renderPopup?: (problem: MapProblemFeature) => React.ReactNode;
  interactive?: boolean;
  /** Accessible name for the map region. */
  label: string;
}

/** Degrees of the larger side of a box. */
export function boxSpan(bbox: BoundingBox): number {
  return Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
}

/**
 * A box of roughly `radiusMeters` around a point. Used to centre a preview —
 * the server measures real distances; this only frames the view.
 */
export function boxAround(center: LatLng, radiusMeters: number): BoundingBox {
  const latDelta = radiusMeters / 111_320;
  const lngDelta =
    radiusMeters /
    (111_320 * Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.01));
  return [
    center.longitude - lngDelta,
    center.latitude - latDelta,
    center.longitude + lngDelta,
    center.latitude + latDelta,
  ];
}
