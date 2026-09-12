import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import type { LeaderboardEntry } from '@/types/domain';
import { Avatar } from '@/components/ui/avatar';

/**
 * One row of the impact leaderboard.
 *
 * The top three get a tinted rank chip — enough to recognise, not so much that
 * the rest of the list reads as an afterthought. `highlighted` marks the
 * viewer's own row so they can find themselves in a long list.
 */
export function LeaderboardRow({
  entry,
  highlighted = false,
  className,
}: {
  entry: LeaderboardEntry;
  highlighted?: boolean;
  className?: string;
}) {
  const isPodium = entry.rank <= 3;
  const trend = entry.trend ?? 0;
  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-control px-3 py-2.5 transition-colors',
        highlighted ? 'bg-primary-soft' : 'hover:bg-subtle',
        className,
      )}
    >
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full tabular type-caption font-semibold',
          isPodium ? 'bg-warning-soft text-warning' : 'text-ink-subtle',
        )}
      >
        {entry.rank}
      </span>

      <Avatar name={entry.person.name} src={entry.person.avatarUrl} size="sm" />

      <div className="min-w-0 flex-1">
        <p className="truncate type-body-sm font-medium text-ink">
          {entry.person.name}
          {highlighted && <span className="ml-1.5 type-caption text-primary">You</span>}
        </p>
        <p className="truncate type-caption text-ink-subtle">
          {entry.problemsReported} reported · {entry.problemsResolved} resolved
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className="tabular type-body-sm font-semibold text-ink">
          {formatNumber(entry.impactPoints)}
        </p>
        <p
          className={cn(
            'inline-flex items-center gap-0.5 type-caption',
            trend > 0 && 'text-success',
            trend < 0 && 'text-danger',
            trend === 0 && 'text-ink-subtle',
          )}
        >
          <TrendIcon className="size-3" aria-hidden="true" />
          <span className="tabular">{trend === 0 ? '—' : Math.abs(trend)}</span>
          <span className="sr-only">
            {trend > 0
              ? `up ${trend} places`
              : trend < 0
                ? `down ${Math.abs(trend)} places`
                : 'no change'}
          </span>
        </p>
      </div>
    </div>
  );
}
