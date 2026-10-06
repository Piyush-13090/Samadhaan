'use client';

import { useCallback, useMemo } from 'react';
import type { BoundingBox } from '@samadhaan/shared';
import { MapExplorer } from '@/components/map/map-explorer';
import type { MapView } from '@/lib/map/config';
import { governmentProblemPath } from '@/lib/government';
import { governmentMapSource } from '@/services/government.service';

/**
 * The government map: Prompt 12's explorer — clustering, severity shapes,
 * popups, the synchronised accessible list — pointed at the office's
 * jurisdiction-scoped endpoints, with review filters, opening on the
 * jurisdiction and linking to the review page.
 */
export function GovernmentMap({
  slug,
  initialView,
  bounds,
}: {
  slug: string;
  initialView: MapView | null;
  bounds: BoundingBox | null;
}) {
  const source = useMemo(() => governmentMapSource(slug), [slug]);
  const hrefFor = useCallback(
    (publicId: string) => governmentProblemPath(slug, publicId),
    [slug],
  );

  return (
    <MapExplorer
      profileCity={null}
      initialView={initialView}
      initialBounds={bounds}
      source={source}
      variant="government"
      hrefFor={hrefFor}
    />
  );
}
