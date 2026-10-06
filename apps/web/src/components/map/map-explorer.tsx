'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, ZoomIn } from 'lucide-react';
import type { BoundingBox, GeocodeResult, MapProblemFeature } from '@samadhaan/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { useDiscoveryLocation } from '@/hooks/use-discovery-location';
import { useMapData } from '@/hooks/use-map-data';
import { mapConfig } from '@/lib/map/config';
import type { MapView } from '@/lib/map/config';
import type { LatLng, MapController, MapViewport } from '@/lib/map/types';
import { searchPlaces, type MapFilters, type MapSource } from '@/services/map.service';
import { CivicMap } from './civic-map';
import { MapControls } from './map-controls';
import { MapFilterBar } from './map-filter-bar';
import { MapLegend } from './map-legend';
import { MapPopup } from './map-popup';
import { MapProblemList } from './map-problem-list';
import { MapSearch } from './map-search';

/**
 * The civic map: search and filters above, the problems as a list beside (or,
 * on a phone, below) the map, and the map itself.
 *
 * The list is not decoration. It is the accessible, keyboard-first view of the
 * same data, and the fallback whenever the map cannot render — every problem
 * on the canvas is reachable from it.
 *
 * **Where it opens:** the viewer's chosen device location if they have shared
 * one; otherwise their profile city, looked up once; otherwise the country.
 * Location is never requested without a tap on "Use my location".
 */
/** One level past where clustering stops (see `PROBLEM_SOURCE.clusterMaxZoom`). */
const SHOW_ON_MAP_ZOOM = 16;

export function MapExplorer({
  profileCity,
  initialView = null,
  initialBounds = null,
  source,
  variant = 'public',
  hrefFor,
}: {
  profileCity: string | null;
  /** An explicit starting view, e.g. from a problem page's link. Wins over everything. */
  initialView?: MapView | null;
  /** An area to open on, e.g. a government office's jurisdiction. */
  initialBounds?: BoundingBox | null;
  /** Where viewport queries go. Defaults to the public map. */
  source?: MapSource;
  /** `government` adds review filters. */
  variant?: 'public' | 'government';
  /** Where a problem links to. Defaults to the public problem page. */
  hrefFor?: (publicId: string) => string;
}) {
  const {
    location,
    locating,
    error: locationError,
    request,
  } = useDiscoveryLocation(profileCity);
  const device = useMemo<LatLng | null>(
    () =>
      location.source === 'device' &&
      location.latitude !== undefined &&
      location.longitude !== undefined
        ? { latitude: location.latitude, longitude: location.longitude }
        : null,
    [location.source, location.latitude, location.longitude],
  );

  const [controller, setController] = useState<MapController | null>(null);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const [filters, setFilters] = useState<MapFilters>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const data = useMapData(viewport, filters, device, undefined, source);

  // Open on the given area — once, before any other positioning.
  const fittedBounds = useRef(false);
  useEffect(() => {
    if (!controller || !initialBounds || initialView || fittedBounds.current) return;
    fittedBounds.current = true;
    controller.fitBounds(initialBounds);
  }, [controller, initialBounds, initialView]);

  // Open on the profile city when there is no device location — once.
  const centredOnCity = useRef(false);
  useEffect(() => {
    if (
      !controller ||
      initialView ||
      initialBounds ||
      device ||
      !profileCity ||
      centredOnCity.current
    )
      return;
    centredOnCity.current = true;
    searchPlaces(profileCity)
      .then(([place]) => {
        if (!place) return;
        if (place.boundingBox) controller.fitBounds(place.boundingBox);
        else controller.flyTo(place, 12);
      })
      .catch(() => {
        // The country view is still a useful starting point.
      });
  }, [controller, initialView, initialBounds, device, profileCity]);

  // Follow the device location when it is granted.
  const lastDevice = useRef<string | null>(null);
  useEffect(() => {
    if (!controller || !device) return;
    const key = `${device.latitude},${device.longitude}`;
    if (lastDevice.current === key) return;
    // An explicit starting view is not overridden on first load.
    if (initialView && lastDevice.current === null) {
      lastDevice.current = key;
      return;
    }
    lastDevice.current = key;
    controller.flyTo(device, 14);
  }, [controller, device, initialView]);

  const goToPlace = useCallback(
    (place: GeocodeResult) => {
      if (!controller) return;
      if (place.boundingBox) controller.fitBounds(place.boundingBox);
      else controller.flyTo(place, mapConfig.placeZoom);
    },
    [controller],
  );

  const showOnMap = useCallback(
    (problem: MapProblemFeature) => {
      setSelectedId(problem.id);
      const [longitude, latitude] = problem.geometry.coordinates;
      // Past the clustering limit, so the problem stands on its own.
      controller?.flyTo({ latitude, longitude }, SHOW_ON_MAP_ZOOM);
    },
    [controller],
  );

  const renderPopup = useCallback(
    (problem: MapProblemFeature) => (
      <MapPopup problem={problem} href={hrefFor?.(problem.properties.publicId)} />
    ),
    [hrefFor],
  );

  // Selection survives only while its problem is still in view.
  const selected = useMemo(
    () =>
      data.problems.some((problem) => problem.id === selectedId) ? selectedId : null,
    [data.problems, selectedId],
  );

  const initial = initialView ?? device ?? mapConfig.defaultView;
  const initialZoom = initialView?.zoom ?? (device ? 14 : mapConfig.defaultView.zoom);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-end">
        <MapSearch onSelect={goToPlace} />
        <MapFilterBar filters={filters} onChange={setFilters} variant={variant} />
      </div>

      {locationError && (
        <Alert tone="warning" title="Couldn't use your location">
          {locationError} Search for a place or move the map instead.
        </Alert>
      )}

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* The map comes first on a phone, second on a desktop. */}
        <div className="relative order-1 h-[55dvh] min-h-80 overflow-hidden rounded-card border border-border lg:order-2 lg:h-[calc(100dvh-14rem)] lg:min-h-[32rem]">
          <CivicMap
            className="absolute inset-0"
            label="Map of civic problems. Use the list of problems to browse them by keyboard."
            initialCenter={initial}
            initialZoom={initialZoom}
            problems={data.problems}
            aggregates={data.aggregates}
            selectedId={selected}
            onSelect={setSelectedId}
            onAggregateSelect={(cell) => {
              const [longitude, latitude] = cell.geometry.coordinates;
              controller?.flyTo({ latitude, longitude }, (viewport?.zoom ?? 6) + 3);
            }}
            onViewportChange={setViewport}
            onReady={setController}
            userLocation={device}
            renderPopup={renderPopup}
            fallbackHint="Problems in this area are listed alongside."
          />

          <MapControls
            controller={controller}
            onLocate={() => void request()}
            locating={locating}
            className="absolute top-3 right-3 z-10"
          />
          <MapLegend className="absolute bottom-3 left-3 z-10 hidden sm:block" />
        </div>

        <section
          aria-labelledby="map-list-heading"
          className="order-2 min-w-0 lg:order-1 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto lg:pr-1"
        >
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="map-list-heading" className="type-h4 text-ink">
              {data.mode === 'problems' ? 'Problems in this area' : 'Problems'}
            </h2>
            {data.mode === 'problems' && data.status === 'ready' && (
              <span className="type-caption text-ink-muted" aria-live="polite">
                {data.problems.length} shown
              </span>
            )}
          </div>

          <MapListBody
            data={data}
            selectedId={selected}
            onShowOnMap={showOnMap}
            hrefFor={hrefFor}
          />
        </section>
      </div>
    </div>
  );
}

function MapListBody({
  data,
  selectedId,
  onShowOnMap,
  hrefFor,
}: {
  data: ReturnType<typeof useMapData>;
  selectedId: string | null;
  onShowOnMap: (problem: MapProblemFeature) => void;
  hrefFor?: (publicId: string) => string;
}) {
  if (
    data.status === 'idle' ||
    (data.status === 'loading' && data.problems.length === 0)
  ) {
    return (
      <div aria-busy="true" aria-label="Loading problems" className="space-y-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-20 animate-shimmer rounded-card bg-subtle" />
        ))}
      </div>
    );
  }

  if (data.status === 'error') {
    return (
      <ErrorState
        size="sm"
        title="Couldn't load problems for this area"
        description="Check your connection, then try again."
        onRetry={data.retry}
      />
    );
  }

  if (data.mode !== 'problems') {
    const total = data.aggregates.reduce((sum, cell) => sum + cell.properties.count, 0);
    return (
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="flex items-center gap-2 type-body-sm font-medium text-ink">
          <ZoomIn className="size-4 text-ink-subtle" aria-hidden="true" />
          Zoom in to see individual problems
        </p>
        <p className="mt-1 type-caption text-ink-muted">
          {data.mode === 'too-wide'
            ? 'This view is too wide to search. Zoom in on a region or search for a place.'
            : `${total} ${total === 1 ? 'problem' : 'problems'} across this view, grouped by area. Select a group or search for a place.`}
        </p>
      </div>
    );
  }

  if (data.problems.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="type-body-sm font-medium text-ink">No problems in this area</p>
        <p className="mt-1 type-caption text-ink-muted">
          Try moving the map, widening the view, or clearing filters.
        </p>
      </div>
    );
  }

  return (
    <div
      className={data.status === 'loading' ? 'opacity-60 transition-opacity' : undefined}
    >
      {data.truncated && (
        <p className="mb-2 flex items-start gap-1.5 type-caption text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Showing the most severe problems here. Zoom in to see the rest.
        </p>
      )}
      <MapProblemList
        problems={data.problems}
        selectedId={selectedId}
        onShowOnMap={onShowOnMap}
        hrefFor={hrefFor}
      />
      {data.status === 'loading' && <span className="sr-only">Updating…</span>}
      <Button asChild variant="link" size="sm" className="mt-3">
        <a href="#main">Back to top</a>
      </Button>
    </div>
  );
}
