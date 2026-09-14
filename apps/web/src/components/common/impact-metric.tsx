import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import type { ImpactStat } from '@/types/domain';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * A single headline figure.
 *
 * Tabular figures keep a row of metrics aligned as values change. The trend
 * arrow pairs with a sign so direction is never carried by colour alone.
 */
export function ImpactMetric({
  stat,
  size = 'md',
  className,
}: {
  stat: ImpactStat;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const positive = (stat.change ?? 0) >= 0;
  const TrendIcon = positive ? TrendingUp : TrendingDown;

  const label = (
    <p className={cn('type-caption text-ink-muted', stat.hint && 'cursor-help')}>
      {stat.label}
    </p>
  );

  return (
    <div
      className={cn(
        'rounded-card border border-border bg-surface',
        size === 'md' ? 'p-4' : 'p-3',
        className,
      )}
    >
      {stat.hint ? <Tooltip content={stat.hint}>{label}</Tooltip> : label}

      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className={cn(
            'tabular font-semibold tracking-tight',
            size === 'md' ? 'type-h2' : 'type-h3',
            stat.pending ? 'text-ink-subtle' : 'text-ink',
          )}
        >
          {/* An em dash, not a zero. A metric whose system does not exist yet
              has no value — reporting 0 would claim it was measured. */}
          {stat.pending ? '—' : formatNumber(stat.value)}
        </span>
        {!stat.pending && stat.unit && (
          <span className="type-caption text-ink-subtle">{stat.unit}</span>
        )}
      </div>

      {stat.pending && <p className="mt-1 type-caption text-ink-subtle">Coming soon</p>}

      {stat.change !== undefined && !stat.pending && (
        <p
          className={cn(
            'mt-1 inline-flex items-center gap-1 type-caption',
            positive ? 'text-success' : 'text-danger',
          )}
        >
          <TrendIcon className="size-3.5" aria-hidden="true" />
          <span className="tabular">
            {positive ? '+' : ''}
            {stat.change}%
          </span>
          <span className="text-ink-subtle">this month</span>
        </p>
      )}
    </div>
  );
}

/** Responsive row of metrics. Two columns on a phone, four on a laptop. */
export function ImpactMetricGroup({
  stats,
  size = 'md',
  className,
}: {
  stats: ImpactStat[];
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4', className)}>
      {stats.map((stat) => (
        <ImpactMetric key={stat.id} stat={stat} size={size} />
      ))}
    </div>
  );
}
