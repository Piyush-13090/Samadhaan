'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  Popup,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapLayerMouseEvent,
  setWorkerUrl,
} from 'maplibre-gl';
import type { MapAggregateCell } from '@samadhaan/shared';
import { mapConfig } from '@/lib/map/config';
import { MAP_COLORS, SEVERITY_MARKERS, SEVERITY_ORDER } from '@/lib/map/severity-markers';
import {
  PROBLEM_CLUSTER_COUNT_LAYER,
  PROBLEM_CLUSTER_LAYER,
  PROBLEM_MARKER_LAYER,
  PROBLEM_SELECTED_LAYER,
  PROBLEM_SOURCE,
  PROBLEMS,
} from '../problem-layers';
import type { MapAdapterProps, MapController, MapViewport } from '@/lib/map/types';

const AGGREGATES = 'aggregates';

/**
 * Where MapLibre's web worker is served from.
 *
 * MapLibre computes its default worker URL relative to its own module, which
 * after bundling points at a file that does not exist. The worker is copied
 * into `public/` by `scripts/vendor-maplibre-worker.mjs` before every dev and
 * build, so it always matches the installed version. Set once, before the
 * first map is created.
 */
setWorkerUrl(`${window.location.origin}/vendor/maplibre/maplibre-gl-worker.mjs`);

/**
 * The MapLibre GL adapter — the only file that knows MapLibre exists.
 *
 * **Markers are GPU layers, not DOM nodes.** Problems go into one GeoJSON
 * source with MapLibre's built-in clustering (supercluster, in a worker), and
 * are drawn by `circle` and `symbol` layers on the WebGL canvas. A thousand
 * problems is a thousand vertices, not a thousand `<div>`s, and clusters
 * re-form on every zoom without React re-rendering anything.
 *
 * The only DOM markers are the two there is ever one of: the viewer's location
 * and the location picker's draggable pin.
 */
export default function MapLibreAdapter(props: MapAdapterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const pinRef = useRef<Marker | null>(null);
  const [loaded, setLoaded] = useState(false);
  // One node for the popup's React content, for the adapter's whole life. This
  // file only ever runs in the browser (`ssr: false`), so `document` exists.
  const [popupNode] = useState(() => document.createElement('div'));

  // The latest props, for event handlers bound once at creation.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // ============================================================== creation

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style: mapConfig.styleUrl,
        center: [props.initialCenter.longitude, props.initialCenter.latitude],
        zoom: props.initialZoom,
        // A civic map is read top-down. Rotation and pitch only disorient.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        interactive: props.interactive ?? true,
        attributionControl: { compact: true },
      });
    } catch {
      // No WebGL, most often. The caller shows the list instead.
      latest.current.onError?.('Your browser could not display the map.');
      return;
    }

    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    let styleLoaded = false;
    map.on('error', (event) => {
      // Before the style loads, any error means there is no map to show. After,
      // a single tile failing is not worth taking the map down for.
      if (!styleLoaded) {
        latest.current.onError?.(
          event.error?.message
            ? 'The map could not be loaded.'
            : 'The map is unavailable.',
        );
      }
    });

    map.on('load', () => {
      styleLoaded = true;
      addSeverityIcons(map);
      addProblemLayers(map);
      addAggregateLayers(map);
      applyStyleFont(map, ['problem-cluster-count', 'aggregate-count']);

      // Compact attribution opens expanded; on a small map that covers half of
      // it. Start collapsed there — the credit stays one tap away on the ⓘ.
      if (container.clientWidth < 480) {
        container
          .querySelector('.maplibregl-ctrl-attrib')
          ?.classList.remove('maplibregl-compact-show');
      }
      bindInteractions(map, latest);
      setLoaded(true);

      latest.current.onReady?.(controllerFor(map));
      latest.current.onViewportChange?.(viewportOf(map));
    });

    // Fires once when movement settles — not on every frame of a drag.
    map.on('moveend', () => latest.current.onViewportChange?.(viewportOf(map)));

    return () => {
      closeQuietly(popupRef.current);
      userMarkerRef.current?.remove();
      pinRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // Created once. Later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ================================================================== data

  useEffect(() => {
    const source = mapRef.current?.getSource<GeoJSONSource>(PROBLEMS);
    if (!loaded || !source) return;
    source.setData({ type: 'FeatureCollection', features: props.problems ?? [] });
  }, [loaded, props.problems]);

  useEffect(() => {
    const source = mapRef.current?.getSource<GeoJSONSource>(AGGREGATES);
    if (!loaded || !source) return;
    source.setData({ type: 'FeatureCollection', features: props.aggregates ?? [] });
  }, [loaded, props.aggregates]);

  // ============================================================= selection

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;

    map.setFilter('problem-selected', [
      '==',
      ['get', 'publicId'],
      props.selectedId ?? '',
    ]);

    // Removing our own popup must not read as the user closing it: MapLibre
    // fires `close` for both, and treating this one as a dismissal would
    // deselect the problem every time the data refreshed under it.
    closeQuietly(popupRef.current);
    popupRef.current = null;

    const selected = props.problems?.find((feature) => feature.id === props.selectedId);
    if (!selected || !props.renderPopup) return;

    const popup = new Popup({
      offset: 16,
      closeButton: true,
      closeOnClick: false,
      maxWidth: '18rem',
      focusAfterOpen: false,
    })
      .setLngLat(selected.geometry.coordinates)
      .setDOMContent(popupNode)
      .addTo(map);

    // Only a user-initiated close (the × button) reaches this.
    const onUserClose = () => {
      if (latest.current.selectedId === selected.id) latest.current.onSelect?.(null);
    };
    popup.on('close', onUserClose);
    quietClose.set(popup, onUserClose);

    popupRef.current = popup;
  }, [loaded, popupNode, props.selectedId, props.problems, props.renderPopup]);

  // ========================================================= user location

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (!props.userLocation) return;

    const dot = document.createElement('div');
    dot.setAttribute('aria-label', 'Your chosen location');
    dot.setAttribute('role', 'img');
    dot.style.cssText = `width:16px;height:16px;border-radius:9999px;background:${MAP_COLORS.user};border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.2)`;

    userMarkerRef.current = new Marker({ element: dot })
      .setLngLat([props.userLocation.longitude, props.userLocation.latitude])
      .addTo(map);
  }, [props.userLocation]);

  // ==================================================================== pin

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!props.pin) {
      pinRef.current?.remove();
      pinRef.current = null;
      return;
    }

    const lngLat: [number, number] = [props.pin.longitude, props.pin.latitude];

    if (pinRef.current) {
      pinRef.current.setLngLat(lngLat);
      return;
    }

    const marker = new Marker({
      draggable: props.interactive !== false,
      color: MAP_COLORS.selection,
    })
      .setLngLat(lngLat)
      .addTo(map);
    marker.getElement().setAttribute('aria-label', 'Problem location. Drag to adjust.');
    marker.on('dragend', () => {
      const position = marker.getLngLat();
      latest.current.onPinChange?.({ latitude: position.lat, longitude: position.lng });
    });
    pinRef.current = marker;
  }, [props.pin, props.interactive]);

  return (
    <>
      {/* The wrapper positions; the container fills it. MapLibre's own CSS sets
          `position: relative` on the container, so positioning it directly
          would be overridden and the map would collapse to zero height. */}
      <div className="absolute inset-0">
        <div
          ref={containerRef}
          role="region"
          aria-label={props.label}
          className="h-full w-full"
        />
      </div>
      {props.renderPopup &&
        (() => {
          const selected = props.problems?.find(
            (feature) => feature.id === props.selectedId,
          );
          return selected ? createPortal(props.renderPopup(selected), popupNode) : null;
        })()}
    </>
  );
}

/** Each popup's user-close handler, so it can be detached before we remove it ourselves. */
const quietClose = new WeakMap<Popup, () => void>();

function closeQuietly(popup: Popup | null): void {
  if (!popup) return;
  const handler = quietClose.get(popup);
  if (handler) popup.off('close', handler);
  popup.remove();
}

// ================================================================== layers

/** Rasterises each severity's shape from its SVG path, at device resolution. */
function addSeverityIcons(map: MapLibreMap): void {
  const ratio = 2;
  const size = 24;

  for (const severity of SEVERITY_ORDER) {
    const marker = SEVERITY_MARKERS[severity];
    if (map.hasImage(marker.icon)) continue;

    const canvas = document.createElement('canvas');
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    const context = canvas.getContext('2d');
    if (!context) continue;

    context.scale(ratio, ratio);
    const path = new Path2D(marker.path);
    context.lineJoin = 'round';
    context.lineWidth = 3;
    context.strokeStyle = MAP_COLORS.outline;
    context.stroke(path);
    context.fillStyle = marker.fill;
    context.fill(path);

    if (severity === 'CRITICAL') {
      // A white inner dot: critical is distinguishable from high even at a
      // glance, and even in greyscale.
      context.beginPath();
      context.arc(12, 12, 3, 0, Math.PI * 2);
      context.fillStyle = MAP_COLORS.outline;
      context.fill();
    }

    map.addImage(marker.icon, context.getImageData(0, 0, canvas.width, canvas.height), {
      pixelRatio: ratio,
    });
  }
}

function addProblemLayers(map: MapLibreMap): void {
  map.addSource(PROBLEMS, PROBLEM_SOURCE);
  map.addLayer(PROBLEM_CLUSTER_LAYER);
  map.addLayer(PROBLEM_CLUSTER_COUNT_LAYER);
  map.addLayer(PROBLEM_SELECTED_LAYER);
  map.addLayer(PROBLEM_MARKER_LAYER);
}

/** Aggregated cells, for viewports too large to show problems one by one. */
function addAggregateLayers(map: MapLibreMap): void {
  map.addSource(AGGREGATES, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'aggregate-cells',
    type: 'circle',
    source: AGGREGATES,
    paint: {
      'circle-color': MAP_COLORS.cluster,
      'circle-opacity': 0.75,
      'circle-stroke-color': MAP_COLORS.outline,
      'circle-stroke-width': 2,
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['get', 'count'],
        1,
        14,
        20,
        22,
        200,
        34,
      ],
    },
  });
  map.addLayer({
    id: 'aggregate-count',
    type: 'symbol',
    source: AGGREGATES,
    layout: {
      'text-field': ['to-string', ['get', 'count']],
      'text-size': 13,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': MAP_COLORS.clusterText },
  });
}

/**
 * Points our count labels at a font the style actually serves.
 *
 * A symbol layer without `text-font` asks for MapLibre's default, which most
 * tile services do not host — the glyph request 404s. The configured style is
 * swappable, so the font is not hardcoded: the first one any of the style's
 * own labels uses is, by construction, one its glyph server has.
 */
function applyStyleFont(map: MapLibreMap, layerIds: string[]): void {
  const font = map
    .getStyle()
    .layers.map(
      (layer) => (layer.layout as Record<string, unknown> | undefined)?.['text-font'],
    )
    .find(
      (value): value is string[] =>
        Array.isArray(value) && value.every((entry) => typeof entry === 'string'),
    );

  if (!font) return;
  for (const id of layerIds) map.setLayoutProperty(id, 'text-font', font);
}

function bindInteractions(
  map: MapLibreMap,
  latest: React.RefObject<MapAdapterProps>,
): void {
  const pointer = (layer: string) => {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  };
  ['problem-clusters', 'problem-points', 'aggregate-cells'].forEach(pointer);

  // A cluster zooms to the level at which it splits apart.
  map.on('click', 'problem-clusters', async (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
    const clusterId = feature?.properties?.cluster_id as number | undefined;
    if (clusterId === undefined || feature?.geometry.type !== 'Point') return;

    const source = map.getSource<GeoJSONSource>(PROBLEMS);
    const zoom = await source?.getClusterExpansionZoom(clusterId);
    map.easeTo({
      center: feature.geometry.coordinates as [number, number],
      zoom: zoom ?? map.getZoom() + 2,
    });
  });

  map.on('click', 'problem-points', (event: MapLayerMouseEvent) => {
    const publicId = event.features?.[0]?.properties?.publicId as string | undefined;
    if (publicId) latest.current?.onSelect?.(publicId);
  });

  map.on('click', 'aggregate-cells', (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature || feature.geometry.type !== 'Point') return;
    const cell = latest.current?.aggregates?.find(
      (candidate) =>
        candidate.geometry.coordinates[0] ===
          (feature.geometry as GeoJSON.Point).coordinates[0] &&
        candidate.geometry.coordinates[1] ===
          (feature.geometry as GeoJSON.Point).coordinates[1],
    );
    if (cell) latest.current?.onAggregateSelect?.(cell as MapAggregateCell);
  });

  // A click on empty map moves the pin, when there is one to move.
  map.on('click', (event) => {
    const props = latest.current;
    if (!props?.onPinChange || props.interactive === false) return;
    const hit = map.queryRenderedFeatures(event.point, {
      layers: ['problem-clusters', 'problem-points', 'aggregate-cells'],
    });
    if (hit.length > 0) return;
    props.onPinChange({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
  });
}

function viewportOf(map: MapLibreMap): MapViewport {
  const bounds = map.getBounds();
  const center = map.getCenter();
  return {
    bbox: [
      clamp(bounds.getWest(), -180, 180),
      clamp(bounds.getSouth(), -90, 90),
      clamp(bounds.getEast(), -180, 180),
      clamp(bounds.getNorth(), -90, 90),
    ],
    zoom: map.getZoom(),
    center: { latitude: center.lat, longitude: center.lng },
  };
}

function controllerFor(map: MapLibreMap): MapController {
  return {
    zoomIn: () => map.zoomIn(),
    zoomOut: () => map.zoomOut(),
    flyTo: (center, zoom) =>
      map.flyTo({
        center: [center.longitude, center.latitude],
        zoom: zoom ?? Math.max(map.getZoom(), mapConfig.placeZoom),
        essential: true,
      }),
    fitBounds: (bbox) =>
      map.fitBounds(new LngLatBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]), {
        padding: 40,
        maxZoom: 16,
      }),
    getViewport: () => viewportOf(map),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
