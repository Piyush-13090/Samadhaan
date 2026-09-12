import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/format';
import type { TimelineEvent } from '@/types/domain';
import { AiSparkIcon } from '@/components/ai/ai-badge';

/**
 * Resolution history.
 *
 * The accountability spine of a problem: who did what, when. Events produced by
 * AI are marked distinctly from those taken by a person, because "the model
 * categorised this" and "the ward office approved this" carry very different
 * weight and must never look the same.
 */
export function ProgressTimeline({
  events,
  className,
}: {
  events: TimelineEvent[];
  className?: string;
}) {
  return (
    <ol className={cn('relative', className)}>
      {events.map((event, index) => {
        const isLast = index === events.length - 1;

        return (
          <li key={event.id} className="relative flex gap-3.5 pb-5 last:pb-0">
            {/* Connector, drawn behind the marker */}
            {!isLast && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-6 bottom-0 left-[11px] w-px',
                  event.state === 'complete' ? 'bg-border-strong' : 'bg-border',
                )}
              />
            )}

            <span
              aria-hidden="true"
              className={cn(
                'relative z-10 grid size-6 shrink-0 place-items-center rounded-full border-2 bg-surface',
                event.state === 'complete' &&
                  'border-transparent bg-success text-ink-inverse',
                event.state === 'current' && 'border-primary',
                event.state === 'upcoming' && 'border-border-strong',
              )}
            >
              {event.state === 'complete' && <Check className="size-3" strokeWidth={3} />}
              {event.state === 'current' && (
                <span className="size-2 rounded-full bg-primary" />
              )}
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  className={cn(
                    'type-body-sm font-medium',
                    event.state === 'upcoming' ? 'text-ink-subtle' : 'text-ink',
                  )}
                >
                  {event.title}
                </h3>
                {event.byAi && (
                  <span className="inline-flex items-center gap-1 rounded-[5px] border border-ai-border bg-ai-soft px-1.5 py-px type-overline text-ai">
                    <AiSparkIcon className="size-2.5" />
                    AI
                  </span>
                )}
              </div>

              {event.description && (
                <p
                  className={cn(
                    'mt-1 type-body-sm',
                    event.state === 'upcoming' ? 'text-ink-subtle' : 'text-ink-muted',
                  )}
                >
                  {event.description}
                </p>
              )}

              <p className="mt-1 type-caption text-ink-subtle">
                {event.state === 'upcoming'
                  ? 'Pending'
                  : formatRelativeTime(event.timestamp)}
                {event.actor && ` · ${event.actor}`}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
