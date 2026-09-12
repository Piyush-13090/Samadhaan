import { cn } from '@/lib/cn';

/**
 * The Samadhaan mark.
 *
 * Concept: a location pin whose interior is a checkmark, drawn as an open path
 * so it also reads as two connected nodes — "a place, and a solution reached".
 * That covers the product in one shape: problems are geographic, and the point
 * of the platform is that they get resolved.
 *
 * Drawn on a 24×24 grid with `currentColor` and rounded joins, so it inherits
 * the surrounding text colour and stays legible from 16px (favicon) to 64px
 * (login). No gradients — it has to survive being one flat colour.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn('size-6', className)}
      aria-hidden="true"
    >
      {/* Pin outline */}
      <path
        d="M12 21.5s7.25-5.6 7.25-11.25a7.25 7.25 0 1 0-14.5 0C4.75 15.9 12 21.5 12 21.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      {/* Checkmark inside, with node terminals */}
      <path
        d="m8.4 10.3 2.5 2.5 4.7-4.7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8.4" cy="10.3" r="1.15" fill="currentColor" />
    </svg>
  );
}

export interface LogoProps {
  /** `full` shows mark + wordmark; `mark` is the icon alone. */
  variant?: 'full' | 'mark';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const MARK_SIZES = {
  sm: 'size-7 rounded-[7px]',
  md: 'size-8 rounded-lg',
  lg: 'size-11 rounded-[11px]',
} as const;

const ICON_SIZES = { sm: 'size-4', md: 'size-5', lg: 'size-6.5' } as const;

const WORD_SIZES = {
  sm: 'text-[13px] tracking-[-0.01em]',
  md: 'text-[15px] tracking-[-0.012em]',
  lg: 'text-xl tracking-[-0.02em]',
} as const;

/**
 * Full lockup: the mark in a filled primary tile beside the wordmark.
 *
 * The tile gives the mark a consistent silhouette across navigation, the login
 * page and loading states, so the brand stays recognisable at small sizes
 * without needing a second asset.
 */
export function Logo({ variant = 'full', size = 'md', className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'grid shrink-0 place-items-center bg-primary text-ink-inverse',
          MARK_SIZES[size],
        )}
      >
        <LogoMark className={ICON_SIZES[size]} />
      </span>

      {variant === 'full' && (
        <span className={cn('font-semibold text-ink', WORD_SIZES[size])}>Samadhaan</span>
      )}
    </span>
  );
}
