'use client';

import { useEffect, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import type { DiscoverySort, ProblemFeed } from '@samadhaan/shared';
import {
  ProblemListCard,
  ProblemListCardSkeleton,
} from '@/components/problems/problem-list-card';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchNearbyProblems } from '@/services/discovery.service';

/**
 * What the community is paying attention to.
 *
 * Three orderings, each a plain count or timestamp — most supported, most
 * recently discussed, most recently reported — so a citizen can see *why* a
 * problem is listed. No learned ranking and nothing that resembles the future
 * AI priority engine. Not a feed either: four problems per view and a link to
 * Explore for the rest.
 *
 * Scoped to the profile's city when there is one, because "most supported
 * across the country" is not actionable for someone deciding what to back.
 */

const VIEWS = [
  {
    sort: 'supported',
    label: 'Most supported',
    empty: 'No problems have been supported yet.',
  },
  {
    sort: 'discussed',
    label: 'Recently discussed',
    empty: 'No problems are being discussed yet.',
  },
  {
    sort: 'recent',
    label: 'Recently reported',
    empty: 'No problems have been reported yet.',
  },
] as const satisfies ReadonlyArray<{ sort: DiscoverySort; label: string; empty: string }>;

type View = (typeof VIEWS)[number]['sort'];

type ViewState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; feed: ProblemFeed };

export function CommunityActivity({
  city,
  limit = 4,
}: {
  /** Profile city; null searches all public problems. */
  city: string | null;
  limit?: number;
}) {
  const [view, setView] = useState<View>('supported');
  // Each view is fetched once and kept, so switching back is instant.
  const [states, setStates] = useState<Partial<Record<View, ViewState>>>({
    supported: { status: 'loading' },
  });
  const [reloadToken, setReloadToken] = useState(0);

  const state = states[view];
  const needsFetch = state?.status === 'loading';

  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;

    const run = async () => {
      try {
        const feed = await fetchNearbyProblems({
          city: city ?? undefined,
          sort: view,
          limit,
        });
        if (!cancelled)
          setStates((current) => ({ ...current, [view]: { status: 'ready', feed } }));
      } catch {
        if (!cancelled)
          setStates((current) => ({ ...current, [view]: { status: 'error' } }));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [view, needsFetch, city, limit, reloadToken]);

  function select(next: string) {
    const nextView = next as View;
    setView(nextView);
    // Raised from the event, not the effect, so the skeleton paints at once.
    setStates((current) =>
      current[nextView] ? current : { ...current, [nextView]: { status: 'loading' } },
    );
  }

  return (
    <Tabs value={view} onValueChange={select}>
      <TabsList aria-label="Community activity views" className="overflow-x-auto">
        {VIEWS.map((item) => (
          <TabsTrigger key={item.sort} value={item.sort}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {VIEWS.map((item) => {
        const current = states[item.sort];

        return (
          <TabsContent key={item.sort} value={item.sort} className="mt-4">
            {!current || current.status === 'loading' ? (
              <ul
                className="grid gap-3 md:grid-cols-2"
                aria-busy="true"
                aria-label="Loading"
              >
                {Array.from({ length: Math.min(limit, 4) }, (_, index) => (
                  <li key={index}>
                    <ProblemListCardSkeleton />
                  </li>
                ))}
              </ul>
            ) : current.status === 'error' ? (
              <Card>
                <ErrorState
                  size="sm"
                  title="Couldn't load community activity"
                  description="Please try again in a moment."
                  onRetry={() => {
                    setStates((all) => ({ ...all, [item.sort]: { status: 'loading' } }));
                    setReloadToken((token) => token + 1);
                  }}
                />
              </Card>
            ) : current.feed.items.length === 0 ? (
              <Card>
                <EmptyState
                  icon={MessagesSquare}
                  title={item.empty}
                  description={
                    city
                      ? `Nothing yet in ${city}. Supporting and discussing problems is how the community shows what matters.`
                      : 'Supporting and discussing problems is how the community shows what matters.'
                  }
                />
              </Card>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {current.feed.items.map((problem) => (
                  <li key={problem.publicId} className="flex">
                    <ProblemListCard
                      problem={problem}
                      showDistance={false}
                      className="w-full"
                    />
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
