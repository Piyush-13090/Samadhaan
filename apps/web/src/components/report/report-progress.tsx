import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export const REPORT_STEPS = ['Problem', 'Location', 'Review'] as const;

export type ReportStepIndex = 0 | 1 | 2;

/**
 * Step indicator for the reporting flow.
 *
 * Marked up as an ordered list with `aria-current="step"`, so a screen reader
 * announces both the position and the total — a purely visual progress bar
 * tells a non-sighted user nothing about how much is left.
 */
export function ReportProgress({
  current,
  className,
}: {
  current: ReportStepIndex;
  className?: string;
}) {
  return (
    <nav aria-label="Report progress" className={className}>
      <ol className="flex items-center gap-1.5 sm:gap-3">
        {REPORT_STEPS.map((label, index) => {
          const done = index < current;
          const active = index === current;

          return (
            <li key={label} className="flex flex-1 items-center gap-2 sm:gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors',
                  done && 'border-transparent bg-primary text-ink-inverse',
                  active && 'border-primary bg-primary-soft text-primary',
                  !done && !active && 'border-border-strong bg-surface text-ink-subtle',
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>

              <span
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'type-body-sm whitespace-nowrap',
                  active ? 'font-medium text-ink' : 'text-ink-subtle',
                  // Only the active label survives on a narrow phone; three
                  // labels plus rules do not fit without wrapping.
                  active ? 'inline' : 'hidden sm:inline',
                )}
              >
                <span className="sr-only">
                  Step {index + 1} of {REPORT_STEPS.length}:{' '}
                </span>
                {label}
              </span>

              {index < REPORT_STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-px flex-1 rounded-full',
                    done ? 'bg-primary' : 'bg-border',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
