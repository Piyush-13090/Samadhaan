'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Compass, MapPinOff, Plus, RotateCw } from 'lucide-react';
import {
  DEFAULT_DISCOVERY_RADIUS_METERS,
  type DiscoverySort,
  type ProblemCategory,
  type ProblemFeed,
  type ProblemStatus,
} from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api-error';
import { useDiscoveryLocation } from '@/hooks/use-discovery-location';
import { fetchNearbyProblems } from '@/services/discovery.service';
import {
  ProblemListCard,
  ProblemListCardSkeleton,
} from '@/components/problems/problem-list-card';
import { NearbyMapPreview } from '@/components/map/nearby-map-preview';
import { DiscoveryFilters } from './discovery-filters';
import { LocationContext } from './location-context';

/**
 * Nearby civic problems, with the filters that narrow them.
 *
 * A client component because only the browser knows where the citizen is. The
 * dashboard around it is server-rendered and does not wait for this — the page
 * is useful before a location exists, and asking for one is an action the
 * citizen takes rather than something that happens to them.
 */
export function NearbyProblems({
  profileCity,
  showMap = true,
  showFilters = true,
  showSort = false,
  paginate = false,
  limit = 6,
  className,
}: {
  /** Coarse locality from the profile, used when no device fix is available. */
  profileCity: string | null;
  showMap?: boolean;
  showFilters?: boolean;
  /** Offers the order control. Explore does; the dashboard keeps it simple. */
  showSort?: boolean;
  /** Offers "Show more" using the feed's cursor. */
  paginate?: boolean;
  limit?: number;
  className?: string;
}) {
  const {
    location,
    locating,
    error: locationError,
    request,
    clear,
  } = useDiscoveryLocation(profileCity);

  const [category, setCategory] = useState<ProblemCategory | 'ALL'>('ALL');
  const [status, setStatus] = useState<ProblemStatus | 'ALL'>('ALL');
  const [radiusMeters, setRadiusMeters] = useState(DEFAULT_DISCOVERY_RADIUS_METERS);
  const [sort, setSort] = useState<DiscoverySort>('relevance');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

  const [feed, setFeed] = useState<ProblemFeed | null>(null);
  // Starts true because a location that is already known triggers a fetch on
  // mount. Set here rather than in the effect: a synchronous setState inside an
  // effect body cascades an extra render, and the polling hooks elsewhere in
  // the app avoid it the same way.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasOrigin = location.source !== 'none';
  // "Nearest" is meaningless without a device fix; fall back rather than send
  // an order the API would silently ignore.
  const effectiveSort: DiscoverySort =
    sort === 'distance' && location.source !== 'device' ? 'relevance' : sort;

  /**
   * Bumped to re-run the search without changing any filter — the Try again
   * button. A counter rather than an exported `load()`, because the fetch lives
   * inside the effect: a function defined outside it and called from it would
   * set state synchronously on every run, cascading an extra render.
   */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!hasOrigin) return;

    let cancelled = false;

    const run = async () => {
      try {
        // The request is issued first, so nothing here touches state until an
        // await has yielded.
        const next = await fetchNearbyProblems({
          latitude: location.latitude,
          longitude: location.longitude,
          city: location.source === 'city' ? location.city : undefined,
          radiusMeters: location.source === 'device' ? radiusMeters : undefined,
          category: category === 'ALL' ? undefined : category,
          status: status === 'ALL' ? undefined : status,
          sort: effectiveSort === 'relevance' ? undefined : effectiveSort,
          limit,
        });

        if (cancelled) return;
        setFeed(next);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        // The fallback says something the heading does not. Repeating the title
        // as the body tells the reader nothing and looks like a rendering bug.
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Something went wrong while searching. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    // Cancels in place of aborting the request: a slow earlier response must
    // not overwrite a faster later one when filters are changed quickly.
    return () => {
      cancelled = true;
    };
  }, [
    hasOrigin,
    location.latitude,
    location.longitude,
    location.city,
    location.source,
    radiusMeters,
    category,
    status,
    effectiveSort,
    limit,
    reloadToken,
  ]);

  /** Appends the next page. The cursor carries the ranking, so pages line up. */
  async function loadMore() {
    if (!feed?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const next = await fetchNearbyProblems({
        latitude: location.latitude,
        longitude: location.longitude,
        city: location.source === 'city' ? location.city : undefined,
        radiusMeters: location.source === 'device' ? radiusMeters : undefined,
        category: category === 'ALL' ? undefined : category,
        status: status === 'ALL' ? undefined : status,
        sort: effectiveSort === 'relevance' ? undefined : effectiveSort,
        limit,
        cursor: feed.nextCursor,
      });
      setFeed((current) =>
        current ? { ...next, items: [...current.items, ...next.items] } : next,
      );
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Wraps a filter change so the skeleton appears immediately.
   *
   * The loading flag is raised from the event that caused the refetch rather
   * than from the effect that performs it — an effect that sets state as its
   * first act triggers a second render before the fetch has even started.
   */
  function onFilterChange<T>(set: (value: T) => void) {
    return (value: T) => {
      setLoading(true);
      set(value);
    };
  }

  const filtersApplied = category !== 'ALL' || status !== 'ALL';

  return (
    <div className={cn('space-y-4', className)}>
      <LocationContext
        location={location}
        locating={locating}
        error={locationError}
        onUseDevice={() => void request()}
        onClear={clear}
      />

      {showFilters && hasOrigin && (
        <DiscoveryFilters
          category={category}
          status={status}
          radiusMeters={radiusMeters}
          showDistance={location.source === 'device'}
          onCategoryChange={onFilterChange(setCategory)}
          onStatusChange={onFilterChange(setStatus)}
          onRadiusChange={onFilterChange(setRadiusMeters)}
          sort={showSort ? effectiveSort : undefined}
          onSortChange={showSort ? onFilterChange(setSort) : undefined}
        />
      )}

      {!hasOrigin ? (
        <Card>
          <EmptyState
            icon={MapPinOff}
            title="Set your location to discover civic issues around you"
            description="Samadhaan uses your location only to find problems reported nearby. You can also add your city to your profile."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={locating}
                  onClick={() => void request()}
                >
                  Use my location
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/profile">Add my city</Link>
                </Button>
              </div>
            }
          />
        </Card>
      ) : error ? (
        <Card>
          <EmptyState
            icon={Compass}
            title="Couldn't load nearby problems"
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
      ) : loading && !feed ? (
        <div className="space-y-4">
          {showMap && location.source === 'device' && (
            <div
              aria-hidden="true"
              className="aspect-[16/10] w-full animate-shimmer rounded-card bg-subtle"
            />
          )}
          <ul className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <li key={index}>
                <ProblemListCardSkeleton />
              </li>
            ))}
          </ul>
        </div>
      ) : feed && feed.items.length === 0 ? (
        <Card>
          {filtersApplied ? (
            <EmptyState
              icon={Compass}
              title="No problems match these filters"
              description="Try a wider distance, another category, or clear the filters."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setLoading(true);
                    setCategory('ALL');
                    setStatus('ALL');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Compass}
              title="Good news — no reported problems nearby"
              description="Nothing has been reported around here yet. If you can see something that needs fixing, you can be the first to report it."
              action={
                <Button variant="primary" size="sm" leadingIcon={<Plus />} asChild>
                  <Link href="/report">Be the first to report an issue</Link>
                </Button>
              }
            />
          )}
        </Card>
      ) : feed ? (
        <div className={cn('space-y-4', loading && 'opacity-60 transition-opacity')}>
          {showMap &&
            location.source === 'device' &&
            location.latitude !== undefined &&
            location.longitude !== undefined && (
              <NearbyMapPreview
                center={{ latitude: location.latitude, longitude: location.longitude }}
                radiusMeters={radiusMeters}
                category={category === 'ALL' ? undefined : category}
                status={status === 'ALL' ? undefined : status}
              />
            )}

          <ul className="grid gap-3 md:grid-cols-2">
            {feed.items.map((problem) => (
              <li key={problem.publicId} className="flex">
                <ProblemListCard
                  problem={problem}
                  showDistance={location.source === 'device'}
                  className="w-full"
                />
              </li>
            ))}
          </ul>

          {paginate && feed.nextCursor && (
            <div className="flex flex-col items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                loading={loadingMore}
                onClick={() => void loadMore()}
              >
                Show more problems
              </Button>
              {loadMoreError && (
                <p role="alert" className="type-caption text-danger">
                  Couldn&rsquo;t load more. Please try again.
                </p>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
