import { HelpCircle } from 'lucide-react';
import type { ProfileActivity } from '@samadhaan/shared';
import { Card } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';

/**
 * Civic activity counts.
 *
 * Every value is a real count from the database. A `null` means the underlying
 * feature does not exist yet and renders as an em dash with an explanation —
 * **not** as zero. "We cannot measure this" and "we measured nothing" are
 * different claims, and showing the second when the first is true is a small
 * lie that compounds into a leaderboard nobody trusts.
 */
export function ActivitySummary({
  activity,
  className,
}: {
  activity: ProfileActivity;
  className?: string;
}) {
  const metrics: Array<{
    id: string;
    label: string;
    value: number | null;
    hint?: string;
  }> = [
    {
      id: 'impact',
      label: 'Impact points',
      value: activity.impactPoints,
      hint: 'Awarded once problem resolution is live.',
    },
    { id: 'reported', label: 'Problems reported', value: activity.problemsReported },
    { id: 'supported', label: 'Problems supported', value: activity.problemsSupported },
    {
      id: 'resolved',
      label: 'Contributed to resolved',
      value: activity.problemsResolved,
      hint: 'Problems you reported, supported or suggested a fix for that were resolved.',
    },
  ];

  return (
    <ul
      className={cn('grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4', className)}
      aria-label="Civic activity"
    >
      {metrics.map((metric) => {
        const unavailable = metric.value === null;

        const label = (
          <p
            className={cn(
              'inline-flex items-center gap-1 type-caption text-ink-muted',
              metric.hint && 'cursor-help',
            )}
          >
            {metric.label}
            {metric.hint && (
              <HelpCircle className="size-3 text-ink-subtle" aria-hidden="true" />
            )}
          </p>
        );

        return (
          <Card key={metric.id} as="li" className="p-4">
            {metric.hint ? <Tooltip content={metric.hint}>{label}</Tooltip> : label}

            <p
              className={cn(
                'mt-1.5 tabular type-h2',
                unavailable ? 'text-ink-subtle' : 'text-ink',
              )}
            >
              {unavailable ? '—' : formatNumber(metric.value as number)}
            </p>

            {unavailable && (
              <p className="mt-0.5 type-caption text-ink-subtle">Not yet available</p>
            )}
          </Card>
        );
      })}
    </ul>
  );
}
