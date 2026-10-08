'use client';

import { Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  LEADERBOARD_PERIODS,
  PROBLEM_CATEGORIES,
  type LeaderboardPage,
  type LeaderboardPeriod,
  type ProblemCategory,
} from '@samadhaan/shared';
import { NativeSelect } from '@/components/project/native-select';
import { Card, CardBody } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import { PERIOD_LABEL } from '@/lib/impact';
import { fetchLeaderboard } from '@/services/impact.service';
import { LeaderboardRow } from './impact-cards';

/**
 * The public leaderboard (Prompt 23): ranked on the server, filtered by
 * period, place and category, paginated. Shows reputation and resolved work
 * beside points, so quality is visible, not only volume.
 */
export function LeaderboardBoard() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('month');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [category, setCategory] = useState<ProblemCategory | ''>('');
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({ city: '', state: '' });
  const [result, setResult] = useState<{ key: string; data: LeaderboardPage } | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify({ period, category, page, ...applied, attempt });

  // Typing a place applies after a pause.
  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied((current) =>
        current.city === city.trim() && current.state === state.trim()
          ? current
          : { city: city.trim(), state: state.trim() },
      );
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [city, state]);

  useEffect(() => {
    const controller = new AbortController();
    fetchLeaderboard(
      {
        period,
        city: applied.city,
        state: applied.state,
        category: category || undefined,
        page,
      },
      controller.signal,
    )
      .then((data) => setResult({ key, data }))
      .catch(() => !controller.signal.aborted && setFailed(key));
    return () => controller.abort();
  }, [period, applied, category, page, key]);

  const data = result?.key === key ? result.data : null;
  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Period"
        className="inline-flex rounded-control border border-border bg-surface p-0.5"
      >
        {LEADERBOARD_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={period === p}
            onClick={() => {
              setPeriod(p);
              setPage(1);
            }}
            className={cn(
              'rounded-[6px] px-3 py-1.5 type-body-sm',
              period === p
                ? 'bg-primary-soft font-medium text-primary'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="City">
          <Input
            value={city}
            maxLength={100}
            placeholder="Any city"
            onChange={(e) => setCity(e.target.value)}
          />
        </Field>
        <Field label="State">
          <Input
            value={state}
            maxLength={100}
            placeholder="Any state"
            onChange={(e) => setState(e.target.value)}
          />
        </Field>
        <Field label="Category">
          <NativeSelect
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as ProblemCategory | '');
              setPage(1);
            }}
          >
            <option value="">Any category</option>
            {PROBLEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_DISPLAY[c].label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {data?.viewer && !data.items.some((i) => i.isViewer) && (
        <div aria-label="Your position">
          <p className="mb-1 type-caption text-ink-muted">Your position</p>
          <LeaderboardRow entry={data.viewer} />
        </div>
      )}

      <Card>
        <CardBody className="p-1.5" aria-busy={data === null} aria-live="polite">
          {failed === key && !data ? (
            <ErrorState
              size="sm"
              title="The leaderboard could not be loaded"
              onRetry={() => setAttempt((a) => a + 1)}
            />
          ) : !data ? (
            <p className="p-4 type-body-sm text-ink-muted">Loading…</p>
          ) : data.items.length === 0 ? (
            <EmptyState
              size="sm"
              icon={Trophy}
              title="No contributions yet"
              description="Points are earned when reports are verified and problems are resolved."
            />
          ) : (
            <ol aria-label="Leaderboard">
              {data.items.map((entry) => (
                <li key={`${entry.rank}-${entry.user.name}`}>
                  <LeaderboardRow entry={entry} />
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
      {data && data.totalPages > 1 && (
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          onPageChange={setPage}
        />
      )}
      <p className="type-caption text-ink-subtle">
        Ranks count confirmed contributions only. Reputation and resolved work are shown
        beside points because time spent is not the same as impact.
      </p>
    </div>
  );
}
