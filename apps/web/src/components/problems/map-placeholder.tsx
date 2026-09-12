import { MapPin } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Stand-in for the interactive map.
 *
 * Drawn as an SVG grid rather than left as a grey box so surrounding layouts
 * can be designed against something map-shaped — and so it never looks like a
 * failed image load. A real tile layer replaces this in the reporting
 * milestone; the wrapper dimensions stay the same.
 */
export function MapPlaceholder({
  label,
  className,
  showPin = true,
}: {
  label?: string;
  className?: string;
  showPin?: boolean;
}) {
  return (
    <div
      role="img"
      aria-label={label ? `Map preview: ${label}` : 'Map preview'}
      className={cn('relative isolate overflow-hidden bg-subtle', className)}
    >
      <svg
        className="absolute inset-0 size-full text-border-strong"
        aria-hidden="true"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 200 120"
      >
        {/* Street grid */}
        <g stroke="currentColor" strokeWidth="0.5" opacity="0.55">
          {[20, 50, 80, 110].map((y) => (
            <line key={`h${y}`} x1="0" y1={y} x2="200" y2={y} />
          ))}
          {[30, 70, 110, 150, 185].map((x) => (
            <line key={`v${x}`} x1={x} y1="0" x2={x} y2="120" />
          ))}
        </g>
        {/* Two arterial roads, heavier */}
        <g stroke="currentColor" strokeWidth="1.6" opacity="0.8">
          <line x1="0" y1="50" x2="200" y2="50" />
          <line x1="110" y1="0" x2="110" y2="120" />
        </g>
        {/* Blocks */}
        <g fill="currentColor" opacity="0.18">
          <rect x="34" y="24" width="32" height="22" rx="1.5" />
          <rect x="118" y="56" width="26" height="20" rx="1.5" />
          <rect x="156" y="24" width="24" height="22" rx="1.5" />
          <rect x="34" y="84" width="30" height="22" rx="1.5" />
        </g>
        {/* Water body */}
        <path
          d="M150 96c12-6 28-4 44 2v22h-52c-2-10 0-18 8-24Z"
          fill="currentColor"
          opacity="0.12"
        />
      </svg>

      {showPin && (
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full">
          <span className="grid size-7 place-items-center rounded-full bg-primary text-ink-inverse shadow-raised">
            <MapPin className="size-4" aria-hidden="true" />
          </span>
          <span className="mx-auto mt-0.5 block size-1.5 rounded-full bg-primary/30" />
        </span>
      )}
    </div>
  );
}
