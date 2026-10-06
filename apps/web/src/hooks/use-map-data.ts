'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MAP_AGGREGATE_MAX_SPAN_DEGREES,
  MAP_DETAIL_MAX_SPAN_DEGREES,
  type MapAggregateCell,
  type MapProblemFeature,
} from '@samadhaan/shared';
import { boxSpan, type LatLng, type MapViewport } from '@/lib/map/types';
import {
  fetchMapAggregate,
  fetchMapProblems,
  PUBLIC_MAP_SOURCE,
  type MapFilters,
  type MapSource,
} from '@/services/map.service';

/** How long the map must be still before its viewport is fetched. */
export const MAP_SETTLE_MS = 350;

export type MapDataMode = 'problems' | 'aggregate' | 'too-wide';

export interface MapData {
  status: 'idle' | 'loading' | 'ready' | 'error';
  mode: MapDataMode;
  problems: MapProblemFeature[];
  aggregates: MapAggregateCell[];
  truncated: boolean;
  retry: () => void;
}

/**
 * Keeps the map's data in step with its viewport.
 *
 *     map settles ─▶ wait 350 ms ─▶ fetch this viewport ─▶ replace markers
 *
 * - **Debounced.** The adapter reports `moveend`, once per gesture; a further
 *   pause absorbs a flick followed by a correction, so a pan is one request.
 * - **Cancelled.** A newer viewport aborts the request for the older one.
 * - **Ordered.** Each request carries a sequence number and only the latest may
 *   write state, so a slow old response can never overwrite a fast new one —
 *   even where abort is not honoured.
 * - **Scaled.** A viewport small enough gets individual problems; a larger one
 *   gets aggregated cells; a hemisphere gets nothing but a prompt to zoom in.
 */
export function useMapData(
  viewport: MapViewport | null,
  filters: MapFilters,
  origin: LatLng | null,
  settleMs = MAP_SETTLE_MS,
  source: MapSource = PUBLIC_MAP_SOURCE,
): MapData {
  const [state, setState] = useState<Omit<MapData, 'retry'>>({
    status: 'idle',
    mode: 'problems',
    problems: [],
    aggregates: [],
    truncated: false,
  });
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);

  // Filters as a stable key: they arrive as a new object on every render.
  const filtersKey = JSON.stringify(filters);
  const sourceKey = `${source.problems}|${source.aggregate}`;
  const bboxKey = viewport
    ? viewport.bbox.map((value) => value.toFixed(5)).join(',')
    : null;

  useEffect(() => {
    if (!viewport) return;

    const span = boxSpan(viewport.bbox);
    const mode: MapDataMode =
      span <= MAP_DETAIL_MAX_SPAN_DEGREES
        ? 'problems'
        : span <= MAP_AGGREGATE_MAX_SPAN_DEGREES
          ? 'aggregate'
          : 'too-wide';

    const id = ++sequence.current;
    const controller = new AbortController();

    const timer = setTimeout(() => {
      if (mode === 'too-wide') {
        setState({
          status: 'ready',
          mode,
          problems: [],
          aggregates: [],
          truncated: false,
        });
        return;
      }

      setState((current) => ({ ...current, status: 'loading' }));
      const active = JSON.parse(filtersKey) as MapFilters;

      const request =
        mode === 'problems'
          ? fetchMapProblems(viewport.bbox, active, {
              origin,
              signal: controller.signal,
              source,
            }).then((collection) => ({
              problems: collection.features,
              aggregates: [] as MapAggregateCell[],
              truncated: collection.truncated,
            }))
          : fetchMapAggregate(viewport.bbox, active, {
              signal: controller.signal,
              source,
            }).then((collection) => ({
              problems: [] as MapProblemFeature[],
              aggregates: collection.features,
              truncated: false,
            }));

      request
        .then((data) => {
          if (id !== sequence.current) return;
          setState({ status: 'ready', mode, ...data });
        })
        .catch(() => {
          if (id !== sequence.current || controller.signal.aborted) return;
          setState((current) => ({ ...current, status: 'error', mode }));
        });
    }, settleMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `bboxKey` stands in for the viewport object, which is new on every report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bboxKey,
    filtersKey,
    sourceKey,
    origin?.latitude,
    origin?.longitude,
    attempt,
    settleMs,
  ]);

  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
