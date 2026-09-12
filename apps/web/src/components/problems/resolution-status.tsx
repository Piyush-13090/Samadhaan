import { cn } from '@/lib/cn';
import { PROBLEM_STATUS_DISPLAY } from '@/lib/domain-display';
import type { ProblemStatus } from '@/types/domain';
import { ProgressBar } from '@/components/ui/progress-bar';

/** The lifecycle stages shown as a stepper, in order. */
const STAGES: Array<{ status: ProblemStatus; label: string }> = [
  { status: 'OPEN', label: 'Reported' },
  { status: 'UNDER_REVIEW', label: 'Reviewed' },
  { status: 'ALLOCATED', label: 'Allocated' },
  { status: 'IN_PROGRESS', label: 'In progress' },
  { status: 'RESOLVED', label: 'Resolved' },
];

/**
 * Prominent resolution state for a problem detail header.
 *
 * Shows the stage the problem has reached plus completion percentage. Rejected
 * problems leave the stepper entirely — they did not stop partway along it,
 * they left the track, and rendering them as a stalled step would misrepresent
 * that.
 */
export function ResolutionStatus({
  status,
  progress,
  className,
}: {
  status: ProblemStatus;
  progress?: number;
  className?: string;
}) {
  const display = PROBLEM_STATUS_DISPLAY[status];
  const activeIndex = STAGES.findIndex((stage) => stage.status === status);
  const rejected = status === 'REJECTED';

  return (
    <section
      className={cn('rounded-card border border-border bg-surface p-4', className)}
      aria-label="Resolution status"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-h4 text-ink">{display.label}</h2>
        {progress !== undefined && !rejected && (
          <span className="type-body-sm tabular font-semibold text-ink">{progress}%</span>
        )}
      </div>
      <p className="mt-0.5 type-body-sm text-ink-muted">{display.description}</p>

      {rejected ? null : (
        <>
          <ol className="mt-4 flex items-center gap-1.5">
            {STAGES.map((stage, index) => {
              const reached = index <= activeIndex;
              return (
                <li key={stage.status} className="flex-1">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'block h-1 rounded-full transition-colors duration-base',
                      reached ? 'bg-primary' : 'bg-subtle',
                      status === 'RESOLVED' && reached && 'bg-success',
                    )}
                  />
                  <span
                    className={cn(
                      'mt-1.5 block type-caption',
                      index === activeIndex ? 'font-medium text-ink' : 'text-ink-subtle',
                      // Only the active label shows on narrow screens; five
                      // labels in a row are unreadable on a phone.
                      index === activeIndex ? 'inline' : 'hidden sm:inline',
                    )}
                  >
                    {stage.label}
                  </span>
                </li>
              );
            })}
          </ol>

          {progress !== undefined && (
            <ProgressBar
              value={progress}
              tone={status === 'RESOLVED' ? 'success' : 'primary'}
              label="Work completed"
              className="mt-4"
            />
          )}
        </>
      )}
    </section>
  );
}
