'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type {
  MapFilterStatus,
  MapProblemFeature,
  ProblemCategory,
  ProblemStatus,
} from '@samadhaan/shared';
import { MAP_FILTER_STATUSES } from '@samadhaan/shared';
import { boxAround, type LatLng } from '@/lib/map/types';
import { fetchMapProblems } from '@/services/map.service';
import { CivicMap } from './civic-map';
import { MapPopup } from './map-popup';

/**
 * A compact map of the problems around the viewer, for the dashboard and
 * Explore. One request for the search radius — no panning-driven refetching;
 * that is what the full map at `/map` is for, one tap away.
 *
 * The list next to it remains the primary, accessible view of the same
 * problems; this preview adds geography, not information that exists nowhere
 * else.
 */
export function NearbyMapPreview({
  center,
  radiusMeters,
  category,
  status,
  className,
}: {
  center: LatLng;
  radiusMeters: number;
  category?: ProblemCategory;
  status?: ProblemStatus;
  className?: string;
}) {
  const [problems, setProblems] = useState<MapProblemFeature[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The map endpoint accepts only browseable statuses; anything else shows the default.
  const mapStatus = (MAP_FILTER_STATUSES as readonly string[]).includes(status ?? '')
    ? (status as MapFilterStatus)
    : undefined;

  // Keyed on the coordinates, not the object: callers build `center` inline,
  // and depending on its identity would refetch on every render.
  const { latitude, longitude } = center;
  const origin = useMemo(() => ({ latitude, longitude }), [latitude, longitude]);
  const bbox = useMemo(() => boxAround(origin, radiusMeters), [origin, radiusMeters]);

  useEffect(() => {
    const controller = new AbortController();
    fetchMapProblems(
      bbox,
      { category, status: mapStatus },
      { origin, limit: 300, signal: controller.signal },
    )
      .then((collection) => setProblems(collection.features))
      .catch(() => {
        // The list beside it already reports failures; the preview just stays empty.
      });
    return () => controller.abort();
  }, [bbox, origin, category, mapStatus]);

  const renderPopup = useCallback(
    (problem: MapProblemFeature) => <MapPopup problem={problem} />,
    [],
  );

  const at = `${center.latitude.toFixed(5)},${center.longitude.toFixed(5)},13`;

  return (
    <figure className={className}>
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-card border border-border sm:aspect-[21/9]">
        <CivicMap
          className="absolute inset-0"
          label="Map of problems near you. The same problems are listed below."
          initialCenter={origin}
          initialZoom={radiusMeters <= 1000 ? 15 : radiusMeters <= 5000 ? 13 : 11}
          problems={problems}
          selectedId={selectedId}
          onSelect={setSelectedId}
          userLocation={origin}
          renderPopup={renderPopup}
          fallbackHint="The same problems are listed below."
        />
      </div>
      <figcaption className="mt-2 flex justify-end">
        <Link
          href={`/map?at=${at}`}
          className="inline-flex items-center gap-1 type-caption font-medium text-primary underline-offset-4 hover:underline"
        >
          Explore the map
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </figcaption>
    </figure>
  );
}
