'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/spinner';
import { AiBadge } from './ai-badge';

/**
 * The stages Samadhaan AI works through when analysing a report.
 *
 * Named here as the canonical order. When the real pipeline lands it reports
 * progress against these same keys, so this component does not change.
 */
export const AI_STAGES = [
  { id: 'image', label: 'Understanding the photo' },
  { id: 'text', label: 'Reading your description' },
  { id: 'nearby', label: 'Checking nearby reports' },
  { id: 'severity', label: 'Assessing severity' },
  { id: 'duplicates', label: 'Finding similar problems' },
] as const;

export type AiStageId = (typeof AI_STAGES)[number]['id'];

export interface AiProcessingStateProps {
  /**
   * Index of the stage currently running. Stages before it render as done.
   * Pass `AI_STAGES.length` to show everything complete.
   */
  activeStage: number;
  className?: string;
}

/**
 * Progress display for an in-flight AI analysis.
 *
 * Showing the named stages rather than an anonymous spinner does two things:
 * it makes a multi-second wait feel accounted for, and it tells the user what
 * the system is actually doing with their photo — which matters when the input
 * is a picture of their neighbourhood.
 *
 * Presentation only. Nothing here runs or calls an analysis.
 */
export function AiProcessingState({ activeStage, className }: AiProcessingStateProps) {
  const complete = activeStage >= AI_STAGES.length;

  return (
    <section
      aria-live="polite"
      aria-busy={!complete}
      className={cn('rounded-card border border-ai-border bg-ai-soft/40 p-4', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <AiBadge label={complete ? 'Analysis complete' : 'Analysing'} />
        {!complete && <Spinner className="size-4 text-ai" label={null} />}
      </div>

      <ol className="mt-4 space-y-2.5">
        {AI_STAGES.map((stage, index) => {
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
                {active && (
                  <span className="size-1.5 animate-shimmer rounded-full bg-ai" />
                )}
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
