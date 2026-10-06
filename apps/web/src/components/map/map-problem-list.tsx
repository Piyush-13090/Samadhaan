'use client';

import Link from 'next/link';
import { MapPin } from 'lucide-react';
import type { MapProblemFeature } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  CATEGORY_DISPLAY,
  PROBLEM_STATUS_DISPLAY,
  SEVERITY_DISPLAY,
} from '@/lib/domain-display';
import { formatDistance } from '@/lib/format';
import { SeverityGlyph } from './map-legend';

/**
 * The map's problems as a plain list — the accessible way in.
 *
 * A canvas cannot be tabbed through or read aloud, so the map is never the only
 * way to reach a problem. Every problem on the map is here, in text: what it
 * is, how severe, where, and how far. Each row links to the problem, and "Show
 * on map" selects it there for those who can see the map.
 */
export function MapProblemList({
  problems,
  selectedId,
  onShowOnMap,
  hrefFor = (publicId) => `/problems/${publicId}`,
  className,
}: {
  problems: MapProblemFeature[];
  selectedId: string | null;
  onShowOnMap?: (problem: MapProblemFeature) => void;
  /** Where a problem links to — the government map opens its review page. */
  hrefFor?: (publicId: string) => string;
  className?: string;
}) {
  return (
    <ul aria-label="Problems in this area" className={cn('space-y-2', className)}>
      {problems.map((problem) => {
        const p = problem.properties;
        const selected = problem.id === selectedId;
        const place = p.area ?? p.city;

        return (
          <li
            key={problem.id}
            className={cn(
              'rounded-card border bg-surface p-3 transition-colors',
              selected ? 'border-primary ring-2 ring-primary/20' : 'border-border',
            )}
            aria-current={selected ? 'true' : undefined}
          >
            <div className="flex items-center gap-1.5 type-caption text-ink-subtle">
              <SeverityGlyph severity={p.severity} className="size-3.5" />
              <span>{SEVERITY_DISPLAY[p.severity].label}</span>
              <span aria-hidden="true">·</span>
              <span>{PROBLEM_STATUS_DISPLAY[p.status].label}</span>
              <span className="ml-auto font-mono">{p.publicId}</span>
            </div>

            <Link
              href={hrefFor(p.publicId)}
              className="mt-1 block type-body-sm font-semibold text-ink hover:text-primary focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              {p.title}
            </Link>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 type-caption text-ink-muted">
              <span>{CATEGORY_DISPLAY[p.category].label}</span>
              {place && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <MapPin className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{place}</span>
                </span>
              )}
              {p.distanceMeters !== null && (
                <span className="tabular">{formatDistance(p.distanceMeters)} away</span>
              )}
            </div>

            {onShowOnMap && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 -ml-2"
                aria-pressed={selected}
                onClick={() => onShowOnMap(problem)}
              >
                Show on map
                <span className="sr-only">: {p.title}</span>
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
