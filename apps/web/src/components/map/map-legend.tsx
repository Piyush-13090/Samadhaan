import type { ProblemSeverity } from '@samadhaan/shared';
import { cn } from '@/lib/cn';
import { SEVERITY_DISPLAY } from '@/lib/domain-display';
import { SEVERITY_MARKERS, SEVERITY_ORDER, MAP_COLORS } from '@/lib/map/severity-markers';

/** One severity's marker shape, as SVG — the same path the map rasterises. */
export function SeverityGlyph({
  severity,
  className,
}: {
  severity: ProblemSeverity;
  className?: string;
}) {
  const marker = SEVERITY_MARKERS[severity];
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn('size-4 shrink-0', className)}
    >
      <path d={marker.path} fill={marker.fill} stroke="#fff" strokeWidth="1.5" />
      {severity === 'CRITICAL' && <circle cx="12" cy="12" r="3" fill="#fff" />}
    </svg>
  );
}

/**
 * What the markers mean. Severity only — one visual rule, explained once —
 * plus the cluster bubble.
 */
export function MapLegend({ className }: { className?: string }) {
  return (
    <section
      aria-label="Map legend"
      className={cn(
        'rounded-control border border-border bg-surface/95 px-3 py-2 shadow-card backdrop-blur-sm',
        className,
      )}
    >
      <p className="type-overline text-ink-subtle">Severity</p>
      <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
        {SEVERITY_ORDER.map((severity) => (
          <li key={severity} className="flex items-center gap-1.5 type-caption text-ink">
            <SeverityGlyph severity={severity} />
            {SEVERITY_DISPLAY[severity].label}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 flex items-center gap-1.5 type-caption text-ink-muted">
        <span
          aria-hidden="true"
          className="inline-flex size-4 items-center justify-center rounded-full text-[9px] font-semibold text-white"
          style={{ background: MAP_COLORS.cluster }}
        >
          n
        </span>
        Group of nearby problems
      </p>
    </section>
  );
}
