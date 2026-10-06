'use client';

import { Search, SlidersHorizontal, Target, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  DISTANCE_OPTIONS,
  MAP_FILTER_STATUSES,
  PROBLEM_CATEGORIES,
  PROBLEM_SEVERITIES,
  REPORTED_WITHIN_OPTIONS,
  WORKSPACE_PROBLEM_SORTS,
  WORKSPACE_PROBLEMS_DEFAULT_LIMIT,
  MIN_RELEVANCE_OPTIONS,
  RECOMMENDATION_SORTS,
  RECOMMENDATION_VIEWS,
  type OrganizationProblemPage,
  type OrganizationProblemItem,
  type RecommendationItem,
  type RecommendationPage,
  type ProblemCategory,
  type ProblemSeverity,
  type ReportedWithinDays,
  type WorkspaceProblemScope,
  type WorkspaceProblemSort,
} from '@samadhaan/shared';
import { ProblemListCardSkeleton } from '@/components/problems/problem-list-card';
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
import {
  CATEGORY_DISPLAY,
  PROBLEM_STATUS_DISPLAY,
  SEVERITY_DISPLAY,
} from '@/lib/domain-display';
import { formatDistance, formatNumber } from '@/lib/format';
import { WORKSPACE_SORT_LABEL, workspacePath } from '@/lib/workspace';
import {
  fetchWorkspaceProblems,
  toWorkspaceQueryString,
  type WorkspaceProblemsQuery,
} from '@/services/workspace.service';
import { OrganizationOpportunityCard } from '@/components/matching/organization-opportunity-card';
import { useToast } from '@/components/ui/toast';
import {
  fetchRecommendations,
  setRecommendationDismissed,
  type RecommendationsQuery,
} from '@/services/matching.service';
import { OrganizationProblemCard } from './organization-problem-card';

/** Typing pause before a text filter is applied. */
export const TEXT_FILTER_DEBOUNCE_MS = 400;

const ALL = 'ALL';

/** Reads the filters from the URL, accepting only known values. */
function readQuery(params: URLSearchParams): RecommendationsQuery {
  const pick = <T extends string | number>(
    key: string,
    allowed: readonly T[],
  ): T | undefined => {
    const raw = params.get(key);
    if (raw === null) return undefined;
    return allowed.find((value) => String(value) === raw);
  };
  const page = Number(params.get('page'));

  return {
    category: pick('category', PROBLEM_CATEGORIES),
    severity: pick('severity', PROBLEM_SEVERITIES),
    status: pick('status', MAP_FILTER_STATUSES),
    sort: pick('sort', WORKSPACE_PROBLEM_SORTS),
    radiusMeters: pick('radiusMeters', DISTANCE_OPTIONS),
    reportedWithinDays: pick('reportedWithinDays', REPORTED_WITHIN_OPTIONS),
    subcategory: params.get('subcategory')?.trim() || undefined,
    city: params.get('city')?.trim() || undefined,
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    minRelevance: pick('minRelevance', MIN_RELEVANCE_OPTIONS),
    view: pick('view', RECOMMENDATION_VIEWS),
  };
}

type Mode = 'problems' | 'recommendations';

function isRecommendation(
  item: OrganizationProblemItem | RecommendationItem,
): item is RecommendationItem {
  return 'match' in item;
}

type Result =
  | { key: string; kind: 'ok'; data: OrganizationProblemPage | RecommendationPage }
  | { key: string; kind: 'error'; message: string; reference?: string };

/**
 * Browse problems as an organisation.
 *
 * Filtering, ordering and pagination all happen on the server — the browser
 * only ever holds one page. The filters live in the URL, so a filtered view can
 * be bookmarked, shared with a teammate, and survives the back button.
 *
 * Inline on large screens; on a phone the fields move into a bottom drawer and
 * the active filters show as a scrollable row of removable chips, so the list
 * stays on screen.
 *
 * In `recommendations` mode the same page lists the AI matching engine's
 * recommendations (Prompt 14) — ordered by relevance, filterable by a minimum
 * relevance, and dismissable by owners and admins.
 */
export function WorkspaceProblems({
  slug,
  scope,
  hasCoordinates,
  mode = 'problems',
  canDismiss = false,
}: {
  slug: string;
  scope: WorkspaceProblemScope;
  /** Distance filters need the organisation's registered location. */
  hasCoordinates: boolean;
  mode?: Mode;
  /** Owners and admins may mark a recommendation not relevant. */
  canDismiss?: boolean;
}) {
  const recommending = mode === 'recommendations';
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(
    () => readQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const requestKey = `${mode}:${toWorkspaceQueryString({ ...query, scope })}`;

  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Text inputs update locally and reach the URL after a pause.
  const [subcategory, setSubcategory] = useState(query.subcategory ?? '');
  const [city, setCity] = useState(query.city ?? '');

  // The text values last written to (or read from) the URL. When the URL
  // changes from outside the inputs — the back button, a shared link — the
  // inputs follow it, instead of the debounce below writing stale text back.
  // The debounce records its own writes here first, so they are not mistaken
  // for outside changes and do not clobber what was typed since.
  const [synced, setSynced] = useState({
    subcategory: query.subcategory,
    city: query.city,
  });
  if (synced.subcategory !== query.subcategory || synced.city !== query.city) {
    setSynced({ subcategory: query.subcategory, city: query.city });
    setSubcategory(query.subcategory ?? '');
    setCity(query.city ?? '');
  }

  function update(changes: Partial<RecommendationsQuery>) {
    const next: RecommendationsQuery = { ...query, ...changes };
    // Any change of filter starts again from the first page.
    if (!('page' in changes)) next.page = undefined;
    router.replace(`${pathname}${toWorkspaceQueryString(next)}`, { scroll: false });
  }

  useEffect(() => {
    const trimmedSubcategory = subcategory.trim() || undefined;
    const trimmedCity = city.trim() || undefined;
    if (trimmedSubcategory === query.subcategory && trimmedCity === query.city) return;

    const timer = setTimeout(() => {
      setSynced({ subcategory: trimmedSubcategory, city: trimmedCity });
      const next: WorkspaceProblemsQuery = {
        ...query,
        subcategory: trimmedSubcategory,
        city: trimmedCity,
        page: undefined,
      };
      router.replace(`${pathname}${toWorkspaceQueryString(next)}`, { scroll: false });
    }, TEXT_FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [subcategory, city, query, pathname, router]);

  useEffect(() => {
    const controller = new AbortController();
    const key = `${requestKey}#${attempt}`;

    const request: Promise<OrganizationProblemPage | RecommendationPage> = recommending
      ? fetchRecommendations(
          slug,
          {
            category: query.category,
            severity: query.severity,
            city: query.city,
            radiusMeters: query.radiusMeters,
            reportedWithinDays: query.reportedWithinDays,
            minRelevance: query.minRelevance,
            sort: query.sort,
            view: query.view,
            page: query.page,
            limit: WORKSPACE_PROBLEMS_DEFAULT_LIMIT,
          },
          controller.signal,
        )
      : fetchWorkspaceProblems(
          slug,
          {
            ...query,
            minRelevance: undefined,
            view: undefined,
            scope,
            limit: WORKSPACE_PROBLEMS_DEFAULT_LIMIT,
          } as WorkspaceProblemsQuery,
          controller.signal,
        );

    request
      .then((data) => setResult({ key, kind: 'ok', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key,
          kind: 'error',
          message:
            error instanceof ApiError && error.status === 400
              ? error.message
              : 'We could not load problems right now.',
          reference: error instanceof ApiError ? error.requestId : undefined,
        });
      });

    return () => controller.abort();
  }, [slug, scope, query, requestKey, attempt, recommending]);

  async function setDismissed(publicId: string, title: string, dismissed: boolean) {
    setBusy(publicId);
    try {
      await setRecommendationDismissed(slug, publicId, dismissed);
      toast({
        tone: 'success',
        title: dismissed ? 'Marked not relevant' : 'Recommendation restored',
        description: title,
      });
      setAttempt((value) => value + 1);
    } catch (error) {
      toast({
        tone: 'danger',
        title: "Couldn't update that recommendation",
        description:
          error instanceof ApiError
            ? error.message
            : 'Check your connection and try again.',
      });
    } finally {
      setBusy(null);
    }
  }

  const current = result?.key === `${requestKey}#${attempt}` ? result : null;

  const active = (
    [
      query.category && {
        key: 'category',
        label: CATEGORY_DISPLAY[query.category].label,
        clear: () => update({ category: undefined }),
      },
      query.subcategory && {
        key: 'subcategory',
        label: `“${query.subcategory}”`,
        clear: () => {
          setSubcategory('');
          update({ subcategory: undefined });
        },
      },
      query.severity && {
        key: 'severity',
        label: `${SEVERITY_DISPLAY[query.severity].label} severity`,
        clear: () => update({ severity: undefined }),
      },
      query.status && {
        key: 'status',
        label:
          PROBLEM_STATUS_DISPLAY[query.status as keyof typeof PROBLEM_STATUS_DISPLAY]
            .label,
        clear: () => update({ status: undefined }),
      },
      query.city && {
        key: 'city',
        label: query.city,
        clear: () => {
          setCity('');
          update({ city: undefined });
        },
      },
      query.radiusMeters && {
        key: 'radius',
        label: `Within ${formatDistance(query.radiusMeters)}`,
        clear: () => update({ radiusMeters: undefined }),
      },
      recommending &&
        query.minRelevance && {
          key: 'relevance',
          label: `At least ${Math.round(query.minRelevance * 100)}% relevance`,
          clear: () => update({ minRelevance: undefined }),
        },
      query.reportedWithinDays && {
        key: 'recent',
        label: `Last ${query.reportedWithinDays === 1 ? 'day' : `${query.reportedWithinDays} days`}`,
        clear: () => update({ reportedWithinDays: undefined }),
      },
    ] as const
  ).filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  function clearAll() {
    setSubcategory('');
    setCity('');
    // The dismissed/active view is a tab, not a filter; clearing keeps it.
    router.replace(`${pathname}${query.view === 'dismissed' ? '?view=dismissed' : ''}`, {
      scroll: false,
    });
  }

  const sortOptions = (
    recommending ? RECOMMENDATION_SORTS : WORKSPACE_PROBLEM_SORTS
  ).filter((sort) => sort !== 'distance' || hasCoordinates);

  const fields = (
    <>
      <Field label="Category" className="min-w-0">
        <Select
          value={query.category ?? ALL}
          onValueChange={(value) =>
            update({ category: value === ALL ? undefined : (value as ProblemCategory) })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {PROBLEM_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {CATEGORY_DISPLAY[category].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {!recommending && (
        <Field label="Subcategory" className="min-w-0">
          <Input
            type="search"
            value={subcategory}
            placeholder="e.g. stormwater"
            maxLength={80}
            onChange={(event) => setSubcategory(event.target.value)}
          />
        </Field>
      )}

      <Field label="Severity" className="min-w-0">
        <Select
          value={query.severity ?? ALL}
          onValueChange={(value) =>
            update({ severity: value === ALL ? undefined : (value as ProblemSeverity) })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All severities</SelectItem>
            {[...PROBLEM_SEVERITIES].reverse().map((severity) => (
              <SelectItem key={severity} value={severity}>
                {SEVERITY_DISPLAY[severity].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {!recommending && (
        <Field label="Status" className="min-w-0">
          <Select
            value={query.status ?? ALL}
            onValueChange={(value) =>
              update({ status: value === ALL ? undefined : value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Active problems</SelectItem>
              {MAP_FILTER_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {PROBLEM_STATUS_DISPLAY[status].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {recommending && (
        <Field label="Relevance" className="min-w-0">
          <Select
            value={query.minRelevance ? String(query.minRelevance) : ALL}
            onValueChange={(value) =>
              update({ minRelevance: value === ALL ? undefined : Number(value) })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any relevance</SelectItem>
              {MIN_RELEVANCE_OPTIONS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  At least {Math.round(value * 100)}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field label="City" className="min-w-0">
        <Input
          type="search"
          value={city}
          placeholder="Any city"
          maxLength={120}
          onChange={(event) => setCity(event.target.value)}
        />
      </Field>

      {hasCoordinates && (
        <Field label="Distance" className="min-w-0">
          <Select
            value={query.radiusMeters ? String(query.radiusMeters) : ALL}
            onValueChange={(value) =>
              update({ radiusMeters: value === ALL ? undefined : Number(value) })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any distance</SelectItem>
              {DISTANCE_OPTIONS.map((meters) => (
                <SelectItem key={meters} value={String(meters)}>
                  Within {formatDistance(meters)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field label="Reported" className="min-w-0">
        <Select
          value={query.reportedWithinDays ? String(query.reportedWithinDays) : ALL}
          onValueChange={(value) =>
            update({
              reportedWithinDays:
                value === ALL ? undefined : (Number(value) as ReportedWithinDays),
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any time</SelectItem>
            {REPORTED_WITHIN_OPTIONS.map((days) => (
              <SelectItem key={days} value={String(days)}>
                {days === 1 ? 'In the last day' : `In the last ${days} days`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  );

  const sortControl = (
    <Field label="Order" className="min-w-0">
      <Select
        value={query.sort ?? 'relevance'}
        onValueChange={(value) =>
          update({
            sort: value === 'relevance' ? undefined : (value as WorkspaceProblemSort),
          })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((sort) => (
            <SelectItem key={sort} value={sort}>
              {WORKSPACE_SORT_LABEL[sort]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  const data = current?.kind === 'ok' ? current.data : null;
  const firstShown = data ? (data.page - 1) * data.limit + 1 : 0;
  const lastShown = data ? firstShown + data.items.length - 1 : 0;

  const showingDismissed = query.view === 'dismissed';

  return (
    <div>
      {recommending && canDismiss && (
        <div
          role="tablist"
          aria-label="Recommendations"
          className="mb-4 inline-flex rounded-control border border-border bg-surface p-0.5"
        >
          {(['active', 'dismissed'] as const).map((view) => {
            const selected = (query.view ?? 'active') === view;
            return (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => update({ view: view === 'active' ? undefined : view })}
                className={
                  selected
                    ? 'rounded-[6px] bg-primary-soft px-3 py-1.5 type-body-sm font-medium text-primary'
                    : 'rounded-[6px] px-3 py-1.5 type-body-sm text-ink-muted hover:text-ink'
                }
              >
                {view === 'active' ? 'Recommended' : 'Marked not relevant'}
              </button>
            );
          })}
        </div>
      )}

      {/* Desktop and tablet: fields inline. */}
      <div
        role="group"
        aria-label="Filter problems"
        className="hidden gap-3 md:grid md:grid-cols-3 xl:grid-cols-4"
      >
        {fields}
        {sortControl}
      </div>

      {/* Phone: one button, the order, and a scrollable row of what is set. */}
      <div className="flex items-end gap-2 md:hidden">
        <Drawer>
          <DrawerTrigger asChild>
            <Button
              variant="secondary"
              size="md"
              leadingIcon={<SlidersHorizontal />}
              className="h-10 shrink-0"
            >
              Filters{active.length > 0 ? ` (${active.length})` : ''}
            </Button>
          </DrawerTrigger>
          <DrawerContent side="bottom" title="Filter problems">
            <div role="group" aria-label="Filter problems" className="grid gap-4 pb-4">
              {fields}
            </div>
          </DrawerContent>
        </Drawer>
        <div className="min-w-0 flex-1">{sortControl}</div>
      </div>

      {active.length > 0 && (
        <div className="-mx-4 mt-3 overflow-x-auto px-4 md:mx-0 md:px-0">
          <ul
            aria-label="Active filters"
            className="flex w-max items-center gap-2 md:w-auto md:flex-wrap"
          >
            {active.map((filter) => (
              <li key={filter.key}>
                <button
                  type="button"
                  onClick={filter.clear}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 type-caption text-ink hover:bg-subtle focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                >
                  {filter.label}
                  <X className="size-3.5 text-ink-subtle" aria-hidden="true" />
                  <span className="sr-only">(remove filter)</span>
                </button>
              </li>
            ))}
            <li>
              <Button variant="link" size="sm" onClick={clearAll}>
                Clear all
              </Button>
            </li>
          </ul>
        </div>
      )}

      <div className="mt-5" aria-live="polite" aria-busy={current === null}>
        {current === null ? (
          <>
            <p className="sr-only">Loading problems</p>
            <ul className="grid gap-3 md:grid-cols-2" aria-hidden="true">
              {Array.from({ length: 4 }, (_, index) => (
                <li key={index}>
                  <ProblemListCardSkeleton />
                </li>
              ))}
            </ul>
          </>
        ) : current.kind === 'error' ? (
          <Card>
            <ErrorState
              title="We couldn't load these problems."
              description={current.message}
              reference={current.reference}
              onRetry={() => setAttempt((value) => value + 1)}
            />
          </Card>
        ) : data && data.items.length === 0 ? (
          <Card>
            {active.length > 0 ? (
              <EmptyState
                icon={Search}
                title="No problems match these filters"
                description="Try a wider distance, another category, or clear the filters."
                action={
                  <Button variant="secondary" size="sm" onClick={clearAll}>
                    Clear filters
                  </Button>
                }
              />
            ) : recommending && showingDismissed ? (
              <EmptyState
                icon={Target}
                title="Nothing marked not relevant"
                description="Recommendations your organisation dismisses appear here, where they can be restored."
              />
            ) : recommending ? (
              <EmptyState
                icon={Target}
                title="No recommended civic opportunities yet."
                description="Samadhaan's matching hasn't found open problems that fit your organisation's areas of work and location. More areas of work in Settings help it find them."
                action={
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={workspacePath(slug, 'problems')}>
                      Browse all problems
                    </Link>
                  </Button>
                }
              />
            ) : scope === 'relevant' ? (
              <EmptyState
                icon={Target}
                title="No relevant civic problems yet."
                description="Your organisation has not discovered any problems matching its expertise and location."
                action={
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={workspacePath(slug, 'problems')}>
                      Browse all problems
                    </Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Search}
                title="No open problems reported yet"
                description="Published civic problems will appear here as citizens report them."
              />
            )}
          </Card>
        ) : data ? (
          <>
            <p className="mb-3 type-caption text-ink-muted">
              Showing <span className="tabular">{firstShown}</span>–
              <span className="tabular">{lastShown}</span> of{' '}
              <span className="tabular">{formatNumber(data.totalCount)}</span>
            </p>
            <ul className="grid gap-3 md:grid-cols-2">
              {data.items.map((problem) => (
                <li key={problem.publicId} className="flex">
                  {isRecommendation(problem) ? (
                    <OrganizationOpportunityCard
                      item={problem}
                      className="w-full"
                      busy={busy === problem.publicId}
                      onDismiss={
                        canDismiss
                          ? () => void setDismissed(problem.publicId, problem.title, true)
                          : undefined
                      }
                      onRestore={
                        canDismiss
                          ? () =>
                              void setDismissed(problem.publicId, problem.title, false)
                          : undefined
                      }
                    />
                  ) : (
                    <OrganizationProblemCard problem={problem} className="w-full" />
                  )}
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
