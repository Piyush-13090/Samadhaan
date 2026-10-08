'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IMPACT_FILTERS, type ImpactFilter, type ImpactSummary } from '@samadhaan/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { FILTER_LABEL, TRANSACTION_LABEL } from '@/lib/impact';
import { fetchImpact } from '@/services/impact.service';

/**
 * The user's impact ledger: every award, why, for which problem, and under
 * which rule version. Corrections appear as their own entries — history is
 * never edited.
 */
export function ContributionHistory({
  onLoaded,
}: {
  onLoaded?: (summary: ImpactSummary) => void;
}) {
  const [filter, setFilter] = useState<ImpactFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ key: string; summary: ImpactSummary } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = `${filter}:${page}:${attempt}`;

  useEffect(() => {
    let active = true;
    fetchImpact(filter, page)
      .then((summary) => {
        if (!active) return;
        setData({ key, summary });
        setFailed(false);
        onLoaded?.(summary);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [filter, page, key, onLoaded]);

  const summary = data?.key === key ? data.summary : null;
  return (
    <Card>
      <CardHeader title="Impact history" description="Why you received each award." />
      <CardBody className="space-y-4">
        <div
          role="tablist"
          aria-label="Filter history"
          className="flex flex-wrap gap-1.5"
        >
          {IMPACT_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
              className={cn(
                'rounded-full border px-3 py-1 type-caption font-medium',
                filter === f
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border text-ink-muted hover:text-ink',
              )}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>

        {failed && !summary ? (
          <ErrorState
            size="sm"
            title="History could not be loaded"
            onRetry={() => setAttempt((a) => a + 1)}
          />
        ) : !summary ? (
          <p className="type-body-sm text-ink-muted">Loading…</p>
        ) : summary.items.length === 0 ? (
          <p className="type-body-sm text-ink-muted">
            Nothing here yet. Points come when a report is verified, a duplicate is
            confirmed, or a problem you helped with is resolved.
          </p>
        ) : (
          <ol className="divide-y divide-border-subtle" aria-label="Impact transactions">
            {summary.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 py-2.5">
                <span
                  className={cn(
                    'tabular w-14 shrink-0 text-right type-body-sm font-semibold',
                    item.amount > 0 ? 'text-success' : 'text-danger',
                  )}
                >
                  {item.amount > 0 ? '+' : ''}
                  {item.amount}
                </span>
                <div className="min-w-0">
                  <p className="type-body-sm text-ink">{TRANSACTION_LABEL[item.type]}</p>
                  <p className="type-caption text-ink-muted">
                    {item.reason}
                    {item.problem && (
                      <>
                        {' · '}
                        <Link
                          href={`/problems/${item.problem.publicId}`}
                          className="text-primary hover:underline"
                        >
                          {item.problem.publicId}
                        </Link>
                      </>
                    )}
                  </p>
                  <p className="type-caption text-ink-subtle">
                    <time
                      dateTime={item.createdAt}
                      title={formatDateTime(item.createdAt)}
                    >
                      {formatRelativeTime(item.createdAt)}
                    </time>{' '}
                    · {item.ruleVersion}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {summary && summary.totalPages > 1 && (
          <Pagination
            page={summary.page}
            totalPages={summary.totalPages}
            onPageChange={setPage}
          />
        )}
      </CardBody>
    </Card>
  );
}
