import { act, useEffect } from 'react';
import { vi } from 'vitest';
import type { MapAdapterProps, MapController, MapViewport } from '@/lib/map/types';

/**
 * A stand-in for the map provider in tests.
 *
 * MapLibre needs WebGL, which jsdom does not have, so the adapter module is
 * replaced (see `vitest.setup.ts`) with this one. It honours the same
 * `MapAdapterProps` contract — everything above the adapter, from `CivicMap` to
 * the explorer, runs for real — and renders what a test needs to see: a marker
 * button per problem, a cell button per aggregate, the popup, the pin.
 *
 * `fakeMap` exposes the latest props and a controller of spies, and `moveTo`
 * simulates the user settling the map on a new viewport.
 */
export const fakeMap = {
  props: null as MapAdapterProps | null,
  controller: {
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    flyTo: vi.fn(),
    fitBounds: vi.fn(),
    getViewport: vi.fn(),
  } satisfies MapController,
  /** Fires `onViewportChange` as the adapter does when movement settles. */
  moveTo(viewport: MapViewport) {
    act(() => {
      fakeMap.props?.onViewportChange?.(viewport);
    });
  },
  reset() {
    fakeMap.props = null;
    for (const fn of Object.values(fakeMap.controller)) fn.mockReset();
  },
};

/** A viewport of `span` degrees around a point. */
export function viewportAround(
  latitude: number,
  longitude: number,
  span = 0.1,
  zoom = 13,
): MapViewport {
  return {
    bbox: [
      longitude - span / 2,
      latitude - span / 2,
      longitude + span / 2,
      latitude + span / 2,
    ],
    zoom,
    center: { latitude, longitude },
  };
}

export default function FakeMapAdapter(props: MapAdapterProps) {
  useEffect(() => {
    fakeMap.props = props;
  });

  useEffect(() => {
    const { latitude, longitude } = props.initialCenter;
    fakeMap.controller.getViewport.mockReturnValue(
      viewportAround(
        latitude,
        longitude,
        props.initialZoom >= 10 ? 0.1 : 30,
        props.initialZoom,
      ),
    );
    props.onReady?.(fakeMap.controller);
    props.onViewportChange?.(fakeMap.controller.getViewport());
    // Mount-only, like the real adapter's `load`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = props.problems?.find((problem) => problem.id === props.selectedId);

  return (
    <div role="region" aria-label={props.label} data-testid="fake-map">
      {props.problems?.map((problem) => (
        <button
          key={problem.id}
          type="button"
          data-testid="map-marker"
          data-severity={problem.properties.severity}
          onClick={() => props.onSelect?.(problem.id)}
        >
          Marker {problem.id}
        </button>
      ))}
      {props.aggregates?.map((cell, index) => (
        <button
          key={index}
          type="button"
          data-testid="map-cell"
          onClick={() => props.onAggregateSelect?.(cell)}
        >
          Cell of {cell.properties.count}
        </button>
      ))}
      {selected && props.renderPopup && (
        <div data-testid="map-popup">{props.renderPopup(selected)}</div>
      )}
      {props.pin && (
        <button
          type="button"
          data-testid="map-pin"
          onClick={() => props.onPinChange?.({ latitude: 12.5, longitude: 77.5 })}
        >
          Pin at {props.pin.latitude},{props.pin.longitude}
        </button>
      )}
      {props.userLocation && <span data-testid="map-user-location" />}
    </div>
  );
}
