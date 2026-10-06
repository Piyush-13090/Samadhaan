'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { MapProblemFeature, ProblemView } from '@samadhaan/shared';
import { CivicMap } from './civic-map';

/**
 * A problem's place, on the problem's own page.
 *
 * Drawn as the problem's own severity marker — the same layer the civic map
 * uses — rather than a generic pin, so the page and the map agree. The
 * location shown is the problem's civic location, which is public because it is
 * what a fixer needs; it is never the reporter's.
 */
export function ProblemLocationMap({
  problem,
  mapHref,
  className,
}: {
  /** Only the fields the map draws — the government view passes its own shape. */
  problem: Pick<
    ProblemView,
    | 'publicId'
    | 'title'
    | 'category'
    | 'subcategory'
    | 'severity'
    | 'status'
    | 'createdAt'
  > & {
    voteCount: number;
    location: Pick<
      ProblemView['location'],
      'latitude' | 'longitude' | 'address' | 'city'
    >;
  };
  /** Where "See problems nearby" goes; `?at=` is appended. Defaults to the public map. */
  mapHref?: string;
  className?: string;
}) {
  const feature = useMemo<MapProblemFeature>(
    () => ({
      type: 'Feature',
      id: problem.publicId,
      geometry: {
        type: 'Point',
        coordinates: [problem.location.longitude, problem.location.latitude],
      },
      properties: {
        publicId: problem.publicId,
        title: problem.title,
        category: problem.category,
        subcategory: problem.subcategory,
        severity: problem.severity,
        status: problem.status,
        area: problem.location.address,
        city: problem.location.city,
        voteCount: problem.voteCount,
        createdAt: problem.createdAt,
        distanceMeters: null,
      },
    }),
    [problem],
  );

  const at = `${problem.location.latitude.toFixed(5)},${problem.location.longitude.toFixed(5)},15`;

  return (
    <div className={className}>
      <div className="relative h-44">
        <CivicMap
          className="absolute inset-0"
          label={`Map showing where ${problem.publicId} was reported${
            problem.location.city ? `, in ${problem.location.city}` : ''
          }.`}
          initialCenter={problem.location}
          initialZoom={15}
          problems={[feature]}
          fallbackHint="The address is listed below."
        />
      </div>
      <Link
        href={`${mapHref ?? '/map'}?at=${at}`}
        className="mt-2 inline-flex px-5 type-caption font-medium text-primary underline-offset-4 hover:underline"
      >
        See problems nearby on the map
      </Link>
    </div>
  );
}
