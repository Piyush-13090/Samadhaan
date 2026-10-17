'use client';

import { SlidersHorizontal, SearchX, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  SEARCH_MIN_QUERY_LENGTH,
  type SearchPage as SearchPageData,
  type SearchResult,
  type SearchUnderstanding,
  type UnifiedSearchResponse,
} from '@samadhaan/shared';
import { useAuth } from '@/components/auth/auth-provider';
import { NativeSelect } from '@/components/project/native-select';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import {
  SEARCH_TABS,
  activeFilterCount,
  apiQuery,
  readSearchState,
  searchQueryString,
  sortOptions,
  type SearchState,
  type SearchTab,
} from '@/lib/search';
import {
  searchAll,
  searchKnowledge,
  searchOrganizations,
  searchProblems,
  searchProjects,
} from '@/services/search.service';
import { SearchFilterPanel } from './search-filter-panel';
import { SearchResultCard } from './search-result-card';

type Loaded =
  | { kind: 'all'; data: UnifiedSearchResponse }
  | { kind: 'list'; page: SearchPageData; items: SearchResult[] };

const FETCH: Record<
  Exclude<SearchTab, 'ALL'>,
  (q: Record<string, string | undefined>, s?: AbortSignal) => Promise<SearchPageData>
> = {
  PROBLEM: searchProblems,
  ORGANIZATION: searchOrganizations,
  KNOWLEDGE: searchKnowledge,
  PROJECT: searchProjects,
};

/**
 * The search page (Prompt 25). Everything — words, tab, filters, sort — is in
 * the URL, so a search can be shared, refreshed and navigated with
 * back/forward. Results come from the API, already filtered by what the
 * viewer may see.
 */
export function SearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { user } = useAuth();
  const state = useMemo(
    () => readSearchState(new URLSearchParams(params.toString())),
    [params],
  );
  const [draft, setDraft] = useState(state.q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [result, setResult] = useState<{ key: string; loaded: Loaded } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState(false);

  const tabs = SEARCH_TABS.filter(
    (t) => t.value !== 'PROJECT' || user?.role !== 'CITIZEN',
  );
  const query = apiQuery(state);
  const needsText = state.type === 'ALL' || state.type === 'KNOWLEDGE';
  const canSearch = !needsText || state.q.length >= SEARCH_MIN_QUERY_LENGTH;
  const key = JSON.stringify({ type: state.type, query, attempt });

  // Keep the box in step with back/forward (adjusting state during render).
  const [syncedQ, setSyncedQ] = useState(state.q);
  if (syncedQ !== state.q) {
    setSyncedQ(state.q);
    setDraft(state.q);
  }

  useEffect(() => {
    if (!canSearch) return;
    const controller = new AbortController();
    const request: Promise<Loaded> =
      state.type === 'ALL'
        ? searchAll(query, controller.signal).then((data) => ({
            kind: 'all' as const,
            data,
          }))
        : FETCH[state.type](query, controller.signal).then((page) => ({
            kind: 'list' as const,
            page,
            items: page.items,
          }));
    request
      .then((loaded) => setResult({ key, loaded }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof ApiError && error.status === 429
            ? 'You are searching very quickly. Wait a moment and try again.'
            : error instanceof ApiError && error.status === 400
              ? error.message
              : 'Search is not available right now.';
        setFailure({ key, message });
      });
    return () => controller.abort();
    // `key` captures the query and tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, canSearch]);

  const navigate = (next: Partial<SearchState>) => {
    router.push(`${pathname}${searchQueryString({ ...state, ...next })}`, {
      scroll: false,
    });
  };

  const loaded = result?.key === key ? result.loaded : null;
  const failed = failure?.key === key ? failure.message : null;
  const understanding: SearchUnderstanding | null =
    loaded?.kind === 'all'
      ? loaded.data.understanding
      : (loaded?.page.understanding ?? null);

  const loadMore = async () => {
    if (loaded?.kind !== 'list' || !loaded.page.nextCursor || state.type === 'ALL')
      return;
    setMore(true);
    try {
      const page = await FETCH[state.type]({ ...query, cursor: loaded.page.nextCursor });
      setResult({
        key,
        loaded: { kind: 'list', page, items: [...loaded.items, ...page.items] },
      });
    } catch {
      setFailure({ key, message: 'More results could not be loaded.' });
    } finally {
      setMore(false);
    }
  };

  const count =
    loaded?.kind === 'all'
      ? loaded.data.problems.items.length +
        loaded.data.organizations.items.length +
        loaded.data.knowledge.items.length +
        (loaded.data.projects?.items.length ?? 0)
      : (loaded?.items.length ?? 0);
  const filters = activeFilterCount(state);

  return (
    <div className="space-y-5">
      <form
        role="search"
        className="sticky top-[var(--spacing-topbar)] z-10 -mx-4 border-b border-border bg-canvas/95 px-4 py-3 backdrop-blur-sm sm:mx-0 sm:rounded-card sm:border sm:px-3"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ q: draft.trim(), interpret: true });
        }}
      >
        <label htmlFor="search-page-input" className="sr-only">
          Search Samadhaan
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
              aria-hidden="true"
            />
            <input
              id="search-page-input"
              type="search"
              value={draft}
              maxLength={200}
              placeholder="Problems, organisations, guidance…"
              onChange={(e) => setDraft(e.target.value)}
              className="h-11 w-full rounded-control border border-border bg-surface pr-3 pl-9 type-body text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <Button type="submit">Search</Button>
        </div>
      </form>

      <div
        role="tablist"
        aria-label="Result type"
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={state.type === tab.value}
            onClick={() => navigate({ type: tab.value })}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-2 type-body-sm',
              state.type === tab.value
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {understanding && understanding.applied.length > 0 && state.interpret && (
        <div
          className="flex flex-wrap items-center gap-2 type-body-sm"
          aria-label="How your search was read"
        >
          <span className="text-ink-muted">Searching for</span>
          {understanding.applied.map((a) => (
            <span
              key={`${a.filter}-${a.value}`}
              className="rounded-full border border-border bg-subtle px-2.5 py-0.5 text-ink"
            >
              {a.label}
            </span>
          ))}
          {understanding.text && (
            <span className="text-ink-muted">“{understanding.text}”</span>
          )}
          {understanding.source === 'ai' && (
            <span className="type-caption text-ink-subtle">
              (read with AI assistance)
            </span>
          )}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => navigate({ interpret: false })}
          >
            Search the exact words instead
          </button>
        </div>
      )}
      {understanding?.needsLocation && !state.lat && (
        <p className="type-body-sm text-ink-muted">
          You asked for results near you. Use <strong>Near me</strong> in the filters to
          share an approximate location.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden lg:block" aria-label="Filters">
          <Card>
            <CardBody>
              <SearchFilterPanel
                key={params.toString()}
                state={state}
                onChange={navigate}
              />
            </CardBody>
          </Card>
        </aside>

        <section aria-labelledby="results-heading" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="results-heading" className="type-h4 text-ink">
              Results
            </h2>
            <div className="flex items-end gap-2">
              <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
                <Button
                  variant="secondary"
                  size="sm"
                  className="lg:hidden"
                  onClick={() => setFiltersOpen(true)}
                >
                  <SlidersHorizontal aria-hidden="true" />
                  Filters{filters > 0 ? ` (${filters})` : ''}
                </Button>
                <DrawerContent side="bottom" title="Filters">
                  <SearchFilterPanel
                    key={params.toString()}
                    state={state}
                    onChange={(patch) => {
                      navigate(patch);
                      setFiltersOpen(false);
                    }}
                  />
                </DrawerContent>
              </Drawer>
              {(state.type === 'PROBLEM' || state.type === 'ALL') && (
                <Field label="Sort">
                  <NativeSelect
                    value={state.sort}
                    onChange={(e) =>
                      navigate({ sort: e.target.value as SearchState['sort'] })
                    }
                  >
                    {sortOptions(state).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
          </div>

          <p role="status" aria-live="polite" className="sr-only">
            {!canSearch
              ? ''
              : loaded
                ? `${count} results`
                : failed
                  ? failed
                  : 'Searching'}
          </p>

          {!canSearch ? (
            <p className="type-body-sm text-ink-muted">
              Type at least {SEARCH_MIN_QUERY_LENGTH} characters to search
              {state.type === 'ALL'
                ? ' everything, or choose Problems or Organisations to browse with filters.'
                : '.'}
            </p>
          ) : failed ? (
            <ErrorState
              size="sm"
              title="Search failed"
              description={failed}
              onRetry={() => setAttempt((a) => a + 1)}
            />
          ) : !loaded ? (
            <div className="space-y-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-card bg-subtle" />
              ))}
            </div>
          ) : loaded.kind === 'all' ? (
            <AllResults
              data={loaded.data}
              onTab={(type) => navigate({ type })}
              q={state.q}
            />
          ) : (
            <ListResults
              page={loaded.page}
              items={loaded.items}
              q={state.q}
              more={more}
              onMore={loadMore}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function RelatedBanner() {
  return (
    <p className="rounded-control border border-info-border bg-info-soft px-3 py-2 type-body-sm text-info">
      No exact matches, but these may be relevant.
    </p>
  );
}

function NoResults({ q }: { q: string }) {
  return (
    <div className="rounded-card border border-dashed border-border p-6 text-center">
      <SearchX className="mx-auto size-6 text-ink-subtle" aria-hidden="true" />
      <p className="mt-2 type-body font-medium text-ink">
        {q ? `No results found for “${q}”` : 'No results found'}
      </p>
      <p className="mt-1 type-body-sm text-ink-muted">Try:</p>
      <ul className="mt-1 inline-block list-disc pl-5 text-left type-body-sm text-ink-muted">
        <li>a broader location</li>
        <li>a different category</li>
        <li>removing a filter</li>
        <li>searching with fewer keywords</li>
      </ul>
    </div>
  );
}

function ListResults({
  page,
  items,
  q,
  more,
  onMore,
}: {
  page: SearchPageData;
  items: SearchResult[];
  q: string;
  more: boolean;
  onMore: () => void;
}) {
  if (items.length === 0) return <NoResults q={q} />;
  return (
    <div className="space-y-3">
      {page.match === 'related' && <RelatedBanner />}
      <ul className="space-y-3" aria-label="Search results">
        {items.map((item) => (
          <li key={`${item.type}-${item.id}`}>
            <SearchResultCard result={item} />
          </li>
        ))}
      </ul>
      {page.nextCursor && (
        <div className="text-center">
          <Button variant="secondary" onClick={onMore} loading={more}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

function AllResults({
  data,
  onTab,
  q,
}: {
  data: UnifiedSearchResponse;
  onTab: (t: SearchTab) => void;
  q: string;
}) {
  const sections: Array<{ type: SearchTab; title: string; page: SearchPageData | null }> =
    [
      { type: 'PROBLEM', title: 'Problems', page: data.problems },
      { type: 'ORGANIZATION', title: 'Organisations', page: data.organizations },
      { type: 'KNOWLEDGE', title: 'Knowledge', page: data.knowledge },
      { type: 'PROJECT', title: 'Your projects', page: data.projects },
    ];
  const visible = sections.filter((s) => s.page && s.page.items.length > 0);
  if (visible.length === 0) return <NoResults q={q} />;
  // Put the section the query asked about first.
  const first = data.understanding?.entityType;
  visible.sort((a, b) => Number(b.type === first) - Number(a.type === first));
  return (
    <div className="space-y-6">
      {visible.map(({ type, title, page }) => (
        <section key={type} aria-labelledby={`section-${type}`} className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 id={`section-${type}`} className="type-body font-semibold text-ink">
              {title}
            </h3>
            <button
              type="button"
              className="type-body-sm text-primary hover:underline"
              onClick={() => onTab(type)}
            >
              See all {title.toLowerCase()}
            </button>
          </div>
          {page!.match === 'related' && <RelatedBanner />}
          <ul className="space-y-3">
            {page!.items.map((item) => (
              <li key={`${item.type}-${item.id}`}>
                <SearchResultCard result={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
