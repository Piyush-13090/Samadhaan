import { cn } from '@/lib/cn';

/**
 * Indeterminate progress.
 *
 * Rendered as an SVG rather than a bordered div so it stays crisp at any size
 * and inherits `currentColor` from its parent — a spinner inside a primary
 * button is white, inside a ghost button it is ink, with no variant plumbing.
 */
export function Spinner({
  className,
  label = 'Loading',
}: {
  className?: string;
  /** Screen-reader text. Set to `null` when a visible label is adjacent. */
  label?: string | null;
}) {
  return (
    <>
      <svg
        className={cn('size-5 animate-spin', className)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="9.5"
          stroke="currentColor"
          strokeWidth="2.5"
          className="opacity-20"
        />
        <path
          d="M21.5 12A9.5 9.5 0 0 0 12 2.5"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {label !== null && <span className="sr-only">{label}</span>}
    </>
  );
}
