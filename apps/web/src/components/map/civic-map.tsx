'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { mapConfig } from '@/lib/map/config';
import type { MapAdapterProps } from '@/lib/map/types';
import { MapErrorState, MapLoadingState } from './map-states';

/**
 * The provider adapter, loaded only in the browser.
 *
 * Map libraries touch `window` and WebGL at import time, and are large — the
 * dynamic import keeps them out of server rendering and out of every page that
 * does not show a map.
 */
const MapLibreAdapter = dynamic(() => import('./maplibre/maplibre-map'), {
  ssr: false,
  loading: () => <MapLoadingState />,
});

export type CivicMapProps = MapAdapterProps & {
  className?: string;
  /** Text shown if the map cannot render. */
  fallbackHint?: string;
};

/**
 * The map, whatever draws it.
 *
 * Callers pass problems, selection and callbacks; this picks the provider from
 * configuration and handles the two ways a map can fail to appear — maps
 * switched off, or the provider failing to start. Either way the box shows a
 * clear message, and every page that uses a map also lists the same problems
 * as text, so nothing is only reachable through the canvas.
 */
export function CivicMap({ className, fallbackHint, ...props }: CivicMapProps) {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  return (
    <div className={cn('relative isolate overflow-hidden bg-subtle', className)}>
      {mapConfig.provider === 'none' ? (
        <MapErrorState message="The map is turned off." hint={fallbackHint} />
      ) : error ? (
        <MapErrorState
          message={error}
          hint={fallbackHint}
          onRetry={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        />
      ) : (
        <MapLibreAdapter
          key={attempt}
          {...props}
          onError={(message) => {
            setError(message);
            props.onError?.(message);
          }}
        />
      )}
    </div>
  );
}
