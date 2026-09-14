'use client';

import { Info } from 'lucide-react';
import type { ProblemListItem } from '@samadhaan/shared';
import { cn } from '@/lib/cn';
import { formatDistance } from '@/lib/format';
import { SEVERITY_DISPLAY } from '@/lib/domain-display';
import { MapPlaceholder } from './map-placeholder';

/**
 * Nearby problems plotted on the development map abstraction.
 *
 * **This is not a live map, and it says so.** No tile provider is configured
 * (`NEXT_PUBLIC_MAP_TILE_URL` is unset), so the base layer is the same drawn
 * grid used elsewhere in the product. What *is* real is the plot: markers are
 * positioned from each problem's actual distance and bearing, so their spread
 * and clustering reflect the data rather than decoration.
 *
 * Pretending otherwise would be worse than the placeholder — a citizen reading
 * a decorative scatter as real geography would draw wrong conclusions about
 * where problems are. When a provider is configured, this component swaps its
 * base layer and keeps the same marker model.
 */
export function NearbyMap({
  problems,
  radiusMeters,
  selectedPublicId,
  onSelect,
  className,
}: {
  problems: ProblemListItem[];
  /** The search radius, which sets the plot's scale. */
  radiusMeters: number;
  selectedPublicId?: string | null;
  onSelect?: (publicId: string) => void;
  className?: string;
}) {
  // Only problems with a measured distance can be placed. A city search has
  // none, so the plot is empty rather than invented.
  const plottable = problems.filter((problem) => problem.distanceMeters !== null);

  return (
    <figure className={cn('overflow-hidden rounded-card border border-border', className)}>
      <div className="relative">
        <MapPlaceholder
          label={`${plottable.length} problems within ${formatDistance(radiusMeters)}`}
          showPin={false}
          className="aspect-[16/10] w-full"
        />

        {/* The viewer, at the centre. */}
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-primary shadow-raised"
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10"
        />

        {plottable.map((problem, index) => {
          const { left, top } = plotPosition(problem, index, plottable.length, radiusMeters);
          const selected = problem.publicId === selectedPublicId;

          return (
            <button
              key={problem.publicId}
              type="button"
              onClick={() => onSelect?.(problem.publicId)}
              style={{ left: `${left}%`, top: `${top}%` }}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface transition-transform duration-base',
                'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1',
                MARKER_COLOR[problem.severity],
                MARKER_SIZE[problem.severity],
                selected ? 'scale-150 ring-2 ring-focus' : 'hover:scale-125',
              )}
            >
              {/* The marker's meaning lives in the label, not the colour. */}
              <span className="sr-only">
                {problem.title}, {SEVERITY_DISPLAY[problem.severity].label} severity,
                {problem.distanceMeters !== null
                  ? ` ${formatDistance(problem.distanceMeters)} away`
                  : ''}
              </span>
            </button>
          );
        })}
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-surface px-3 py-2">
        <span className="flex items-center gap-1.5 type-caption text-ink-subtle">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          Illustrative plot — positions reflect real distances, the base map does not.
        </span>

        <ul className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((severity) => (
            <li
              key={severity}
              className="flex items-center gap-1.5 type-caption text-ink-muted"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'rounded-full',
                  MARKER_COLOR[severity],
                  MARKER_SIZE[severity],
                )}
              />
              {SEVERITY_DISPLAY[severity].label}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/**
 * Marker colour, following the product's severity tones.
 *
 * HIGH and CRITICAL deliberately share `danger` — that is the palette's
 * judgement and the badges elsewhere say the same thing, so diverging here
 * would make the map disagree with every other surface.
 */
const MARKER_COLOR: Record<ProblemListItem['severity'], string> = {
  LOW: 'bg-ink-subtle',
  MEDIUM: 'bg-warning',
  HIGH: 'bg-danger',
  CRITICAL: 'bg-danger',
};

/**
 * Marker size, which is what separates HIGH from CRITICAL.
 *
 * Severity must not rest on colour alone, and here it cannot: the two most
 * serious bands share a colour, so size carries the difference for a sighted
 * reader and the marker's label carries it for everyone else.
 */
const MARKER_SIZE: Record<ProblemListItem['severity'], string> = {
  LOW: 'size-2.5',
  MEDIUM: 'size-3',
  HIGH: 'size-3.5',
  CRITICAL: 'size-4.5',
};

/**
 * Places a marker from its real distance.
 *
 * The radius is to scale — a problem at half the search radius sits half way
 * out. The *bearing* is not known: the API returns distance without direction,
 * deliberately, because publishing a bearing alongside a distance would let
 * anyone triangulate an exact location from two queries. So markers are spread
 * evenly around the circle by index, which keeps them legible and separable
 * without implying a direction the data does not contain.
 */
function plotPosition(
  problem: ProblemListItem,
  index: number,
  total: number,
  radiusMeters: number,
): { left: number; top: number } {
  const distance = problem.distanceMeters ?? 0;
  // 42% of the box is the outer edge, leaving room for the marker itself.
  const scale = Math.min(distance / Math.max(radiusMeters, 1), 1) * 42;
  // Golden-angle spacing, so nearby markers do not stack even at small radii.
  const angle = index * 2.399_963 + (total % 2) * 0.5;

  return {
    left: 50 + scale * Math.cos(angle),
    top: 50 + scale * Math.sin(angle) * 0.72,
  };
}
