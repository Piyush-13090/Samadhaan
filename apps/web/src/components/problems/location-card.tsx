import { MapPin, Navigation } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDistance } from '@/lib/format';
import type { ProblemLocation } from '@/types/domain';
import { MapPlaceholder } from './map-placeholder';

/**
 * Where a problem is. Pairs a map preview with the readable address and the
 * exact coordinates, because all three get used: the map to orient, the
 * address to recognise, the coordinates to navigate to.
 */
export function LocationCard({
  location,
  className,
}: {
  location: ProblemLocation;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-card border border-border bg-surface',
        className,
      )}
      aria-label="Location"
    >
      <MapPlaceholder className="h-36" label={location.area ?? 'Reported location'} />

      <div className="space-y-2.5 p-4">
        <div className="flex items-start gap-2.5">
          <MapPin className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <div className="min-w-0">
            <p className="type-body-sm text-ink">{location.address}</p>
            {location.area && (
              <p className="mt-0.5 type-caption text-ink-subtle">{location.area}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle pt-2.5 type-caption text-ink-subtle">
          <span className="font-mono tabular">
            {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
          </span>
          {location.distanceMeters !== undefined && (
            <span className="inline-flex items-center gap-1">
              <Navigation className="size-3" aria-hidden="true" />
              {formatDistance(location.distanceMeters)} away
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
