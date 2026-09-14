'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus, RotateCw } from 'lucide-react';
import type {
  PaginatedData,
  ProblemCategory,
  ProblemListItem,
  ProblemStatus,
} from '@samadhaan/shared';
import { PROBLEM_CATEGORIES } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api-error';
import { CATEGORY_DISPLAY, PROBLEM_STATUS_DISPLAY } from '@/lib/domain-display';
import { fetchMyProblems } from '@/services/discovery.service';
import { ProblemListCard, ProblemListCardSkeleton } from './problem-list-card';

const SORTS = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'severity', label: 'Most severe' },
  { value: 'status', label: 'By status' },
] as const;

const FILTERABLE_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'IN_PROGRESS',
  'RESOLVED',
  'DUPLICATE',
] as const satisfies readonly ProblemStatus[];

/**
 * The citizen's own reports, filterable and paginated.
 *
 * Seeded with the first page from the server so the list is there on first
 * paint; filtering and paging happen on the client from then on. The API
 * scopes every page to the verified principal — there is no parameter here or
 * there that could point it at anyone else.
 */
const EMPTY_PAGE: PaginatedData<ProblemListItem> = {
  items: [],
  nextCursor: null,
  totalCount: 0,
};

export function MyProblemsList({
  initial,
  className,
}: {
  /** `null` when the server could not reach the API; the list says so. */
  initial: PaginatedData<ProblemListItem> | null;
  className?: string;
}) {
  const [status, setStatus] = useState<ProblemStatus | 'ALL'>('ALL');
  const [category, setCategory] = useState<ProblemCategory | 'ALL'>('ALL');
  const [sort, setSort] = useState<(typeof SORTS)[number]['value']>('recent');

  const [page, setPage] = useState<PaginatedData<ProblemListItem>>(initial ?? EMPTY_PAGE);
  const [loading, setLoading] = useState(false);

  /** Raises the skeleton at the point of the interaction that causes a refetch. */
  const onFilterChange = <T,>(set: (value: T) => void) => (value: T) => {
    setLoading(true);
    set(value);
  };
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(
    initial === null ? 'Samadhaan could not reach the server. Please try again.' : null,
  );

  /**
   * Bumped to re-run the query without changing a filter — the Try again
   * button. A counter rather than a callable `load()`, because the fetch lives
   * inside the effect below: a function defined outside it and called from it
   * would set state synchronously on every run, cascading an extra render.
   */
  const [reloadToken, setReloadToken] = useState(0);

  // Distinguishes the first render from a filter change, so the server-rendered
  // page is not immediately refetched for no reason.
  const initialRender = useRef(true);

  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        // Issued before any state is touched, so nothing runs synchronously
        // when the effect calls it.
        const next = await fetchMyProblems({
          status: status === 'ALL' ? undefined : status,
          category: category === 'ALL' ? undefined : category,
          sort,
        });

        if (cancelled) return;
        setPage(next);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Something went wrong while loading them. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    // A slow earlier response must not overwrite a faster later one when
    // filters are changed quickly.
    return () => {
      cancelled = true;
    };
  }, [status, category, sort, reloadToken]);

  const loadMore = useCallback(async () => {
    if (!page.nextCursor) return;

    setLoadingMore(true);
    setError(null);

    try {
      const next = await fetchMyProblems({
        status: status === 'ALL' ? undefined : status,
        category: category === 'ALL' ? undefined : category,
        sort,
        cursor: page.nextCursor,
      });

      setPage((current) => ({
        items: [...current.items, ...next.items],
        nextCursor: next.nextCursor,
        totalCount: next.totalCount,
      }));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Something went wrong while loading more. Please try again.',
      );
    } finally {
      setLoadingMore(false);
    }
  }, [page.nextCursor, status, category, sort]);

  const filtersApplied = status !== 'ALL' || category !== 'ALL';

  return (
    <div className={cn('space-y-5', className)}>
      <div role="group" aria-label="Filter your reports" className="grid gap-3 sm:grid-cols-3">
        <Field label="Status">
          <Select
            value={status}
            onValueChange={(value) => onFilterChange(setStatus)(value as ProblemStatus | 'ALL')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {FILTERABLE_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {PROBLEM_STATUS_DISPLAY[value].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Category">
          <Select
            value={category}
            onValueChange={(value) => onFilterChange(setCategory)(value as ProblemCategory | 'ALL')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {PROBLEM_CATEGORIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {CATEGORY_DISPLAY[value].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Sort">
          <Select
            value={sort}
            onValueChange={(value) => onFilterChange(setSort)(value as (typeof SORTS)[number]['value'])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {error ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="Couldn't load your reports"
            description={error}
            action={
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<RotateCw />}
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  setReloadToken((token) => token + 1);
                }}
              >
                Try again
              </Button>
            }
          />
        </Card>
      ) : loading ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index}>
              <ProblemListCardSkeleton />
            </li>
          ))}
        </ul>
      ) : page.items.length === 0 ? (
        <Card>
          {filtersApplied ? (
            <EmptyState
              icon={FileText}
              title="No reports match these filters"
              description="Try a different status or category."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setLoading(true);
                    setStatus('ALL');
                    setCategory('ALL');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="You haven't reported any problems yet"
              description="When you see something in your area that needs fixing, report it here and Samadhaan will take it from there."
              action={
                <Button variant="primary" size="sm" leadingIcon={<Plus />} asChild>
                  <Link href="/report">Report a problem</Link>
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2">
            {page.items.map((problem) => (
              <li key={problem.publicId} className="flex">
                <ProblemListCard problem={problem} showDistance={false} className="w-full" />
              </li>
            ))}
          </ul>

          {page.nextCursor && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
