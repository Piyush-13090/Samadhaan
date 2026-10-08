'use client';

import { CircleHelp, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import {
  NOT_ENOUGH_DATA,
  formatChange,
  formatValue,
  metricDefinition,
  metricLabel,
} from '@/lib/analytics';
import { cn } from '@/lib/cn';

/**
 * Building blocks for analytics (Prompt 24). Every chart here is decorative
 * (`aria-hidden`) and is paired with a table carrying the same numbers.
 */

/** The "?" beside a metric: its precise definition, on hover and on focus. */
export function MetricHelp({ metric, text }: { metric: string; text?: string }) {
  const definition = text ?? metricDefinition(metric);
  if (!definition) return null;
  return (
    <Tooltip content={<span className="block max-w-xs">{definition}</span>}>
      <button
        type="button"
        aria-label={`How ${metricLabel(metric).toLowerCase()} is measured: ${definition}`}
        className="inline-flex text-ink-subtle hover:text-ink focus-visible:text-ink"
      >
        <CircleHelp className="size-3.5" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

export function MetricCard({
  metric,
  value,
  unit,
  change,
  hint,
}: {
  metric: string;
  value: number | null | undefined;
  unit?: 'days' | '%';
  /** Undefined: this metric is not compared. Null: comparison unavailable. */
  change?: number | null;
  hint?: string;
}) {
  const missing = value === null || value === undefined;
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="flex items-center gap-1.5 type-caption text-ink-muted">
        {metricLabel(metric)}
        <MetricHelp metric={metric} />
      </p>
      <p
        className={cn(
          'mt-1',
          missing ? 'type-body-sm text-ink-subtle' : 'type-h3 tabular-nums text-ink',
        )}
      >
        {formatValue(value, unit)}
      </p>
      {change !== undefined && (
        <p
          className={cn(
            'mt-1 flex items-center gap-1 type-caption',
            change === null ? 'text-ink-subtle' : 'text-ink-muted',
          )}
        >
          {change !== null && change > 0 && (
            <TrendingUp className="size-3.5" aria-hidden="true" />
          )}
          {change !== null && change < 0 && (
            <TrendingDown className="size-3.5" aria-hidden="true" />
          )}
          {formatChange(change)}
        </p>
      )}
      {hint && <p className="mt-1 type-caption text-ink-subtle">{hint}</p>}
    </div>
  );
}

/** A section with its own loading, error and empty handling. */
export function AnalyticsSection<T>({
  title,
  description,
  state,
  isEmpty,
  emptyText = NOT_ENOUGH_DATA,
  onRetry,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  state: { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: T };
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  onRetry?: () => void;
  action?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <CardBody aria-busy={state.status === 'loading'}>
        {state.status === 'loading' ? (
          <div className="space-y-2" aria-label={`Loading ${title.toLowerCase()}`}>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : state.status === 'error' ? (
          <ErrorState
            size="sm"
            title={`${title} could not be loaded`}
            onRetry={onRetry}
          />
        ) : isEmpty?.(state.data) ? (
          <p className="type-body-sm text-ink-subtle">{emptyText}</p>
        ) : (
          children(state.data)
        )}
      </CardBody>
    </Card>
  );
}

/** Horizontal bars with the numbers beside them; screen readers get the list. */
export function BarList({
  label,
  rows,
  format = (n) => formatValue(n),
}: {
  label: string;
  rows: Array<{ key: string; label: ReactNode; value: number; note?: ReactNode }>;
  format?: (value: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="space-y-2">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 type-body-sm">
            <span className="min-w-0 truncate text-ink">{row.label}</span>
            <span className="shrink-0 tabular-nums text-ink-muted">
              {format(row.value)}
              {row.note && <span className="ml-2 type-caption">{row.note}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-subtle" aria-hidden="true">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A plain, accessible data table. */
export function DataTable({
  caption,
  columns,
  rows,
  visuallyHidden = false,
}: {
  caption: string;
  columns: Array<{ key: string; label: string; numeric?: boolean }>;
  rows: Array<Record<string, ReactNode>>;
  visuallyHidden?: boolean;
}) {
  return (
    <div className={cn(visuallyHidden ? 'sr-only' : 'overflow-x-auto')}>
      <table className="w-full type-body-sm">
        <caption className={cn(visuallyHidden ? '' : 'sr-only')}>{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left type-caption text-ink-muted">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn('py-2 pr-3 font-medium', c.numeric && 'text-right')}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {columns.map((c, j) =>
                j === 0 ? (
                  <th
                    key={c.key}
                    scope="row"
                    className="py-2 pr-3 text-left font-normal text-ink"
                  >
                    {row[c.key]}
                  </th>
                ) : (
                  <td
                    key={c.key}
                    className={cn(
                      'py-2 pr-3 text-ink-muted',
                      c.numeric && 'text-right tabular-nums',
                    )}
                  >
                    {row[c.key]}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Several series per bucket, as grouped bars. */
export function SeriesChart({
  buckets,
  series,
}: {
  buckets: ReadonlyArray<{ label: string }>;
  series: Array<{ key: string; label: string; className: string }>;
}) {
  const WIDTH = 640;
  const HEIGHT = 170;
  const PAD = { top: 8, right: 4, bottom: 22, left: 28 };
  const at = (bucket: { label: string }, key: string) =>
    Number((bucket as unknown as Record<string, unknown>)[key]) || 0;
  const values = buckets.flatMap((b) => series.map((s) => at(b, s.key)));
  const max = Math.max(1, ...values);
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const step = plotWidth / Math.max(1, buckets.length);
  const barWidth = Math.max(1.5, (step * 0.8) / series.length);
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;
  const labelEvery = Math.ceil(buckets.length / 6);

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(max * f)}
              y2={y(max * f)}
              className="stroke-border"
              strokeDasharray={f === 0 ? undefined : '3 3'}
            />
            <text
              x={PAD.left - 6}
              y={y(max * f) + 3}
              textAnchor="end"
              className="fill-ink-subtle text-[10px]"
            >
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {buckets.map((bucket, i) => (
          <g key={`${bucket.label}-${i}`}>
            {series.map((s, j) => {
              const value = at(bucket, s.key);
              return (
                <rect
                  key={s.key}
                  x={PAD.left + step * i + step * 0.1 + barWidth * j}
                  y={y(value)}
                  width={barWidth}
                  height={Math.max(0, PAD.top + plotHeight - y(value))}
                  rx={1}
                  className={s.className}
                />
              );
            })}
            {i % labelEvery === 0 && (
              <text
                x={PAD.left + step * i + step / 2}
                y={HEIGHT - 6}
                textAnchor="middle"
                className="fill-ink-subtle text-[10px]"
              >
                {bucket.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <ul
        className="mt-2 flex flex-wrap gap-4 type-caption text-ink-muted"
        aria-hidden="true"
      >
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={cn('inline-block size-2.5 rounded-sm', s.className)} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NotEnoughData({ children = NOT_ENOUGH_DATA }: { children?: ReactNode }) {
  return <p className="type-body-sm text-ink-subtle">{children}</p>;
}
