'use client';

import { Crosshair, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { DiscoveryLocation } from '@/hooks/use-discovery-location';

/**
 * Where discovery is searching from, and how to change it.
 *
 * Always states the source. "Near Gurugram" and "Near your current location"
 * are different promises, and a citizen deciding whether a feed is relevant
 * needs to know which one they are reading.
 *
 * Coordinates are never printed. They would put precise personal data on screen
 * for no benefit — the label already answers the question.
 */
export function LocationContext({
  location,
  locating,
  error,
  onUseDevice,
  onClear,
  className,
}: {
  location: DiscoveryLocation;
  locating: boolean;
  error: string | null;
  onUseDevice: () => void;
  onClear: () => void;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="flex items-center gap-1.5 type-body-sm text-ink-muted">
          <MapPin className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          {location.source === 'none' ? (
            <span>No location set</span>
          ) : (
            <>
              <span>Problems near</span>
              <span className="font-medium text-ink">{location.label}</span>
            </>
          )}
        </p>

        {location.source === 'device' ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Change location
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Crosshair />}
            loading={locating}
            onClick={onUseDevice}
          >
            Use my location
          </Button>
        )}
      </div>

      {error && (
        <p role="status" className="type-caption text-warning">
          {error}
        </p>
      )}
    </div>
  );
}
