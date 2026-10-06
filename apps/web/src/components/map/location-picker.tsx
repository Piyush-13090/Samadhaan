'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { GeocodeResult } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { mapConfig } from '@/lib/map/config';
import type { LatLng, MapController } from '@/lib/map/types';
import { reverseGeocode } from '@/services/map.service';
import { CivicMap } from './civic-map';
import { MapControls } from './map-controls';
import { MapSearch } from './map-search';

/**
 * Choose exactly where a problem is: search for the place, then drag the pin
 * — or tap the map — onto the spot.
 *
 * Each placement is looked up as an address through the API, and offered, not
 * imposed: "Use this address" fills the form, so nothing the citizen typed is
 * overwritten behind their back. If the lookup fails the pin still counts; the
 * address fields remain theirs to fill.
 *
 * The coordinates are what is stored. The address is for people.
 */
export function LocationPicker({
  value,
  onChange,
  onUseAddress,
  className,
}: {
  value: LatLng | null;
  onChange: (position: LatLng) => void;
  /** Applies a looked-up address to the form. */
  onUseAddress: (place: GeocodeResult) => void;
  className?: string;
}) {
  const [controller, setController] = useState<MapController | null>(null);
  const [lookup, setLookup] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'found'; place: GeocodeResult }
    | { status: 'none' }
  >({ status: 'idle' });

  // Reverse-geocode each new pin position, ignoring stale answers.
  const latestKey = useRef<string | null>(null);
  useEffect(() => {
    if (!value) return;
    const key = `${value.latitude.toFixed(5)},${value.longitude.toFixed(5)}`;
    latestKey.current = key;

    const timer = setTimeout(() => {
      setLookup({ status: 'loading' });
      reverseGeocode(value)
        .then((place) => {
          if (latestKey.current !== key) return;
          setLookup(place ? { status: 'found', place } : { status: 'none' });
        })
        .catch(() => {
          if (latestKey.current === key) setLookup({ status: 'none' });
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [value]);

  // Keep the pin in view when it is set from outside — "Use my location".
  const lastFocused = useRef<string | null>(null);
  useEffect(() => {
    if (!controller || !value) return;
    const key = `${value.latitude},${value.longitude}`;
    if (lastFocused.current === key) return;
    lastFocused.current = key;
    controller.flyTo(value, Math.max(controller.getViewport().zoom, 16));
  }, [controller, value]);

  return (
    <div className={className}>
      <MapSearch
        placeholder="Search for the street or landmark"
        onSelect={(place) => {
          // Searching moves the pin too — the result is a starting point to
          // drag from, not a final answer.
          onChange({ latitude: place.latitude, longitude: place.longitude });
          if (place.boundingBox) controller?.fitBounds(place.boundingBox);
        }}
      />

      <div className="relative mt-3 h-72 overflow-hidden rounded-card border border-border sm:h-80">
        <CivicMap
          className="absolute inset-0"
          label="Map for choosing the problem's location. Drag the pin or tap the map to move it."
          initialCenter={value ?? mapConfig.defaultView}
          initialZoom={value ? 16 : mapConfig.defaultView.zoom}
          pin={value}
          onPinChange={onChange}
          onReady={setController}
          fallbackHint="Enter the coordinates and address below instead."
        />
        <MapControls controller={controller} className="absolute top-3 right-3 z-10" />
      </div>

      <div aria-live="polite" className="mt-2 min-h-6 type-caption text-ink-muted">
        {!value ? (
          'Search for the place, or tap the map where the problem is.'
        ) : lookup.status === 'loading' ? (
          'Looking up the address…'
        ) : lookup.status === 'found' ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{lookup.place.label}</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => onUseAddress(lookup.place)}
            >
              Use this address
            </Button>
          </span>
        ) : lookup.status === 'none' ? (
          "We couldn't find an address here — add a landmark below so people can find it."
        ) : null}
      </div>
    </div>
  );
}
