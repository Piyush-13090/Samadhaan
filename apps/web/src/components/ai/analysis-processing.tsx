'use client';

import { Check } from 'lucide-react';
import { ANALYSIS_STAGES } from '@samadhaan/shared';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/spinner';
import { AiBadge } from './ai-badge';

/**
 * Shown while an analysis is running.
 *
 * The stages are **indicative, not measured** — the API reports one status, not
 * per-stage progress, so this advances on a timer to show the work is moving.
 * That is honest for a progress indicator (a spinner claims no more) but it
 * must never be mistaken for real telemetry, which is why the stage list is
 * presentational and carries no data.
 *
 * Stages advance roughly every 1.6s and hold at the last one, so a slow
 * analysis never shows a completed checklist while it is still working.
 */
export function AnalysisProcessing({
  elapsedMs,
  className,
}: {
  /** Milliseconds since polling began. Drives the indicative stage. */
  elapsedMs: number;
  className?: string;
}) {
  const activeStage = Math.min(
    Math.floor(elapsedMs / 1600),
    ANALYSIS_STAGES.length - 1,
  );

  return (
    <section
      aria-live="polite"
      aria-busy="true"
      className={cn('rounded-card border border-ai-border bg-ai-soft/40 p-5', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <AiBadge label="Analysing" />
        <Spinner className="size-4 text-ai" label={null} />
      </div>

      <h3 className="mt-4 type-h4 text-ink">
        Samadhaan AI is analysing your report
      </h3>
      <p className="mt-1 type-body-sm text-ink-muted">
        This usually takes a few seconds.
      </p>

      <ol className="mt-4 space-y-2.5">
        {ANALYSIS_STAGES.map((stage, index) => {
          const done = index < activeStage;
          const active = index === activeStage;

          return (
            <li key={stage.id} className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-4.5 shrink-0 place-items-center rounded-full border transition-colors duration-base',
                  done && 'border-ai bg-ai text-ink-inverse',
                  active && 'border-ai bg-surface',
                  !done && !active && 'border-border-strong bg-surface',
                )}
              >
                {done && <Check className="size-3" strokeWidth={3} />}
                {active && <span className="size-1.5 animate-shimmer rounded-full bg-ai" />}
              </span>

              <span
                className={cn(
                  'type-body-sm transition-colors duration-base',
                  done && 'text-ink-muted',
                  active && 'font-medium text-ink',
                  !done && !active && 'text-ink-subtle',
                )}
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
