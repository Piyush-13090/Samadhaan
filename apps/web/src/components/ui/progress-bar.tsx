'use client';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/cn';
import type { Tone } from '@/types/ui';

const FILL_COLORS: Record<Tone, string> = {
  neutral: 'bg-ink-subtle',
  primary: 'bg-primary',
  ai: 'bg-ai',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export interface ProgressBarProps {
  /** 0–100. */
  value: number;
  tone?: Tone;
  size?: 'sm' | 'md';
  /** Accessible name. Required — a bare bar tells a screen reader nothing. */
  label: string;
  /** Renders the label and percentage above the bar. */
  showLabel?: boolean;
  className?: string;
}

/**
 * Determinate progress bar.
 *
 * Radix supplies the `progressbar` role and the `aria-value*` attributes, so
 * the percentage is announced rather than being purely visual.
 */
export function ProgressBar({
  value,
  tone = 'primary',
  size = 'md',
  label,
  showLabel = false,
  className,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={cn('w-full', className)}>
      {showLabel && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="type-caption text-ink-muted">{label}</span>
          <span className="type-caption tabular font-medium text-ink">{clamped}%</span>
        </div>
      )}

      <ProgressPrimitive.Root
        value={clamped}
        aria-label={showLabel ? undefined : label}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-subtle',
          size === 'sm' ? 'h-1' : 'h-1.5',
        )}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            'h-full rounded-full transition-transform duration-slow ease-out-quart',
            FILL_COLORS[tone],
          )}
          style={{ transform: `translateX(-${100 - clamped}%)` }}
        />
      </ProgressPrimitive.Root>
    </div>
  );
}

/**
 * Indeterminate bar for work of unknown duration — used by the AI processing
 * state, where stage timings vary too much to estimate a percentage.
 */
export function IndeterminateBar({
  tone = 'ai',
  label,
  className,
}: {
  tone?: Tone;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cn(
        'relative h-1 w-full overflow-hidden rounded-full bg-subtle',
        className,
      )}
    >
      <span
        className={cn(
          'absolute inset-y-0 w-1/4 rounded-full animate-progress-stripe',
          FILL_COLORS[tone],
        )}
      />
    </div>
  );
}
