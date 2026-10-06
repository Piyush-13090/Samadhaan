'use client';

import { ClipboardCheck, Search, SlidersHorizontal, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  AI_STATUS_FILTERS,
  DUPLICATE_FILTERS,
  GOVERNMENT_SORTS,
  GOVERNMENT_STATUS_FILTERS,
  PROBLEM_CATEGORIES,
  PROBLEM_SEVERITIES,
  type GovernmentProblemPage,
} from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import {
  CATEGORY_DISPLAY,
  PROBLEM_STATUS_DISPLAY,
  SEVERITY_DISPLAY,
} from '@/lib/domain-display';
import { formatNumber } from '@/lib/format';
import { AI_STATUS_LABEL, DUPLICATE_FILTER_LABEL } from '@/lib/government';
import { toWorkspaceQueryString } from '@/services/workspace.service';
import {
  fetchGovernmentProblems,
  type GovernmentProblemsQuery,
} from '@/services/government.service';
import { ReviewQueueItem } from './review-queue-item';

export const SEARCH_DEBOUNCE_MS = 400;
const ALL = 'ALL';

const SORT_LABEL: Record<(typeof GOVERNMENT_SORTS)[number], string> = {
  queue: 'Review order',
  newest: 'Newest',
  oldest: 'Oldest',
  severity: 'Most severe',
  supported: 'Most supported',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function readQuery(params: URLSearchParams): GovernmentProblemsQuery {
  const pick = (key: string, allowed: readonly string[]) => {
    const value = params.get(key);
    return value && allowed.includes(value) ? value : undefined;
  };
  const page = Number(params.get('page'));
  const date = (key: string) => {
    const value = params.get(key);
    return value && DATE.test(value) ? value : undefined;
  };
  return {
    view: params.get('view') === 'all' ? 'all' : undefined,
    status: pick('status', GOVERNMENT_STATUS_FILTERS),
    severity: pick('severity', PROBLEM_SEVERITIES),
    category: pick('category', PROBLEM_CATEGORIES),
    aiStatus: pick('aiStatus', AI_STATUS_FILTERS),
    duplicate: pick('duplicate', DUPLICATE_FILTERS),
    sort: pick('sort', GOVERNMENT_SORTS),
    q: params.get('q')?.trim() || undefined,
    area: params.get('area')?.trim() || undefined,
    reportedFrom: date('reportedFrom'),
    reportedTo: date('reportedTo'),
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

type Result =
  | { key: string; kind: 'ok'; data: GovernmentProblemPage }
  | { key: string; kind: 'error'; message: string; reference?: string };

/**
 * The review queue, filterable and searchable.
 *
 * Filtering, search and pagination all happen on the server, inside the
 * office's jurisdiction; filters live in the URL so a view can be shared with
 * a colleague. "Needs review" is the default view; "All reports" lifts the
 * status restriction. On a phone the fields move into a drawer.
 */
export function ReviewList({ slug }: { slug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(
    () => readQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const requestKey = toWorkspaceQueryString(query as never);

  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [q, setQ] = useState(query.q ?? '');
  const [area, setArea] = useState(query.area ?? '');
  // Follow the URL when it changes from outside the inputs; the debounce
  // records its own writes first (see WorkspaceProblems for the reasoning).
  const [synced, setSynced] = useState({ q: query.q, area: query.area });
  if (synced.q !== query.q || synced.area !== query.area) {
    setSynced({ q: query.q, area: query.area });
    setQ(query.q ?? '');
    setArea(query.area ?? '');
  }

  function update(changes: Partial<GovernmentProblemsQuery>) {
    const next = { ...query, ...changes };
    if (!('page' in changes)) next.page = undefined;
    router.replace(`${pathname}${toWorkspaceQueryString(next as never)}`, {
      scroll: false,
    });
  }

  useEffect(() => {
    const nextQ = q.trim().length >= 2 ? q.trim() : undefined;
    const nextArea = area.trim().length >= 2 ? area.trim() : undefined;
    if (nextQ === query.q && nextArea === query.area) return;
    const timer = setTimeout(() => {
      setSynced({ q: nextQ, area: nextArea });
      router.replace(
        `${pathname}${toWorkspaceQueryString({ ...query, q: nextQ, area: nextArea, page: undefined } as never)}`,
        { scroll: false },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, area, query, pathname, router]);

  useEffect(() => {
    const controller = new AbortController();
    const key = `${requestKey}#${attempt}`;
    fetchGovernmentProblems(slug, query, controller.signal)
      .then((data) => setResult({ key, kind: 'ok', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key,
          kind: 'error',
          message:
            error instanceof ApiError && error.status === 400
              ? error.message
              : 'We could not load the review queue right now.',
          reference: error instanceof ApiError ? error.requestId : undefined,
        });
      });
    return () => controller.abort();
  }, [slug, query, requestKey, attempt]);

  const current = result?.key === `${requestKey}#${attempt}` ? result : null;
  const data = current?.kind === 'ok' ? current.data : null;
  const allReports = query.view === 'all';
  const filtered = Boolean(
    query.status ||
    query.severity ||
    query.category ||
    query.aiStatus ||
    query.duplicate ||
    query.q ||
    query.area ||
    query.reportedFrom ||
    query.reportedTo,
  );

  const select = (
    label: string,
    value: string | undefined,
    onChange: (value: string | undefined) => void,
    options: Array<[string, string]>,
    allLabel: string,
  ) => (
    <Field label={label} className="min-w-0">
      <Select
        value={value ?? ALL}
        onValueChange={(next) => onChange(next === ALL ? undefined : next)}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  const fields = (
    <>
      {allReports &&
        select(
          'Status',
          query.status,
          (status) => update({ status }),
          GOVERNMENT_STATUS_FILTERS.map((status) => [
            status,
            PROBLEM_STATUS_DISPLAY[status].label,
          ]),
          'Any status',
        )}
      {select(
        'Severity',
        query.severity,
        (severity) => update({ severity }),
        [...PROBLEM_SEVERITIES]
          .reverse()
          .map((severity) => [severity, SEVERITY_DISPLAY[severity].label]),
        'Any severity',
      )}
      {select(
        'Category',
        query.category,
        (category) => update({ category }),
        PROBLEM_CATEGORIES.map((category) => [
          category,
          CATEGORY_DISPLAY[category].label,
        ]),
        'Any category',
      )}
      {select(
        'AI analysis',
        query.aiStatus,
        (aiStatus) => update({ aiStatus }),
        AI_STATUS_FILTERS.map((status) => [status, AI_STATUS_LABEL[status]]),
        'Any',
      )}
      {select(
        'Duplicates',
        query.duplicate,
        (duplicate) => update({ duplicate }),
        DUPLICATE_FILTERS.map((filter) => [filter, DUPLICATE_FILTER_LABEL[filter]]),
        'Any',
      )}
      <Field label="Area or address" className="min-w-0">
        <Input
          type="search"
          value={area}
          maxLength={120}
          placeholder="e.g. Sector 48"
          onChange={(event) => setArea(event.target.value)}
        />
      </Field>
      <Field label="Reported from" className="min-w-0">
        <Input
          type="date"
          value={query.reportedFrom ?? ''}
          onChange={(event) => update({ reportedFrom: event.target.value || undefined })}
        />
      </Field>
      <Field label="Reported to" className="min-w-0">
        <Input
          type="date"
          value={query.reportedTo ?? ''}
          onChange={(event) => update({ reportedTo: event.target.value || undefined })}
        />
      </Field>
      {select(
        'Order',
        query.sort,
        (sort) => update({ sort }),
        GOVERNMENT_SORTS.filter((sort) => sort !== 'queue').map((sort) => [
          sort,
          SORT_LABEL[sort],
        ]),
        SORT_LABEL.queue,
      )}
    </>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div
          role="tablist"
          aria-label="Which reports"
          className="inline-flex rounded-control border border-border bg-surface p-0.5"
        >
          {(
            [
              ['queue', 'Needs review'],
              ['all', 'All reports'],
            ] as const
          ).map(([view, label]) => {
            const selected = (query.view ?? 'queue') === view;
            return (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() =>
                  update({ view: view === 'all' ? 'all' : undefined, status: undefined })
                }
                className={cn(
                  'rounded-[6px] px-3 py-1.5 type-body-sm',
                  selected
                    ? 'bg-primary-soft font-medium text-primary'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        <label className="relative min-w-0 flex-1 basis-60">
          <span className="sr-only">
            Search by reference, title, description or address
          </span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={q}
            maxLength={120}
            placeholder="Search SAM-1023, a title, an address…"
            className="pl-9"
            onChange={(event) => setQ(event.target.value)}
          />
        </label>
      </div>

      <div
        role="group"
        aria-label="Filter reports"
        className="mt-4 hidden gap-3 md:grid md:grid-cols-3 xl:grid-cols-4"
      >
        {fields}
      </div>

      <div className="mt-3 flex items-center gap-2 md:hidden">
        <Drawer>
          <DrawerTrigger asChild>
            <Button
              variant="secondary"
              size="md"
              leadingIcon={<SlidersHorizontal />}
              className="h-10"
            >
              Filters
            </Button>
          </DrawerTrigger>
          <DrawerContent side="bottom" title="Filter reports">
            <div role="group" aria-label="Filter reports" className="grid gap-4 pb-4">
              {fields}
            </div>
          </DrawerContent>
        </Drawer>
        {filtered && (
          <Button
            variant="ghost"
            size="md"
            leadingIcon={<X />}
            onClick={() => router.replace(pathname, { scroll: false })}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="mt-5" aria-live="polite" aria-busy={current === null}>
        {current === null ? (
          <>
            <p className="sr-only">Loading reports</p>
            <ul aria-hidden="true" className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <li key={index} className="h-36 animate-shimmer rounded-card bg-subtle" />
              ))}
            </ul>
          </>
        ) : current.kind === 'error' ? (
          <Card>
            <ErrorState
              title="We couldn't load the review queue."
              description={current.message}
              reference={current.reference}
              onRetry={() => setAttempt((value) => value + 1)}
            />
          </Card>
        ) : data && data.items.length === 0 ? (
          <Card>
            {filtered ? (
              <EmptyState
                icon={Search}
                title="No reports match"
                description="Try another search, or clear the filters."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => router.replace(pathname, { scroll: false })}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={ClipboardCheck}
                title={
                  allReports
                    ? 'No reports in your jurisdiction yet'
                    : 'Nothing waiting for review'
                }
                description={
                  allReports
                    ? 'Reports filed inside your area will appear here.'
                    : 'New reports in your jurisdiction will appear here for review.'
                }
              />
            )}
          </Card>
        ) : data ? (
          <>
            <p className="mb-3 type-caption text-ink-muted">
              <span className="tabular">{formatNumber(data.totalCount)}</span>{' '}
              {data.totalCount === 1 ? 'report' : 'reports'}
            </p>
            <ul
              aria-label={allReports ? 'Reports' : 'Reports needing review'}
              className="grid gap-3 md:grid-cols-2"
            >
              {data.items.map((item) => (
                <li key={item.publicId} className="flex">
                  <ReviewQueueItem slug={slug} item={item} className="w-full" />
                </li>
              ))}
            </ul>
            <Pagination
              className="mt-6"
              page={data.page}
              totalPages={data.totalPages}
              onPageChange={(page) => {
                update({ page: page > 1 ? page : undefined });
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
