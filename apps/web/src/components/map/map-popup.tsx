import Link from 'next/link';
import type { MapProblemFeature } from '@samadhaan/shared';
import {
  CATEGORY_DISPLAY,
  PROBLEM_STATUS_DISPLAY,
  SEVERITY_DISPLAY,
} from '@/lib/domain-display';
import { formatDistance } from '@/lib/format';
import { SeverityGlyph } from './map-legend';

/**
 * The compact card for a selected marker.
 *
 * Public civic facts only — the reference, title, category, severity, status
 * and how far away it is. Nothing about who reported it.
 */
export function MapPopup({
  problem,
  href,
}: {
  problem: MapProblemFeature;
  /** Defaults to the public problem page. */
  href?: string;
}) {
  const p = problem.properties;
  const category = CATEGORY_DISPLAY[p.category].label;

  return (
    <div className="min-w-0 space-y-1.5 font-sans">
      <p className="font-mono type-caption text-ink-subtle">{p.publicId}</p>
      <p className="type-body-sm font-semibold text-ink">{p.title}</p>
      <p className="type-caption text-ink-muted">
        {category}
        {p.subcategory ? ` · ${p.subcategory}` : ''}
      </p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-caption text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <SeverityGlyph severity={p.severity} className="size-3.5" />
          {SEVERITY_DISPLAY[p.severity].label} severity
        </span>
        <span aria-hidden="true">·</span>
        <span>{PROBLEM_STATUS_DISPLAY[p.status].label}</span>
        {p.distanceMeters !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular">{formatDistance(p.distanceMeters)} away</span>
          </>
        )}
      </p>
      <Link
        href={href ?? `/problems/${p.publicId}`}
        className="mt-1 inline-flex font-medium text-primary type-body-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      >
        View problem
      </Link>
    </div>
  );
}
