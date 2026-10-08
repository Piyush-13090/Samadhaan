'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BadgeView, ImpactSummary, ReputationView } from '@samadhaan/shared';
import { ErrorState } from '@/components/ui/states';
import { Card } from '@/components/ui/card';
import { fetchBadges, fetchReputation } from '@/services/impact.service';
import { ContributionHistory } from './contribution-history';
import { BadgeGrid, ImpactScoreCard, ReputationCard } from './impact-cards';

/**
 * The signed-in user's impact (Prompt 23): points, reputation, badges, and
 * the full history. `compact` is the profile-page summary.
 */
export function ImpactOverview({ compact = false }: { compact?: boolean }) {
  const [reputation, setReputation] = useState<ReputationView | null>(null);
  const [badges, setBadges] = useState<BadgeView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [summary, setSummary] = useState<ImpactSummary | null>(null);

  const load = useCallback(() => {
    Promise.all([fetchReputation(), fetchBadges()])
      .then(([r, b]) => {
        setReputation(r);
        setBadges(b);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (failed && !reputation) {
    return (
      <Card>
        <ErrorState size="sm" title="Your impact could not be loaded" onRetry={load} />
      </Card>
    );
  }
  if (!reputation || !badges)
    return <p className="type-body-sm text-ink-muted">Loading your impact…</p>;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <ImpactScoreCard
          impactPoints={summary?.impactPoints ?? reputation.impactPoints}
          resolvedContributions={reputation.resolvedContributions}
          href={compact ? '/profile/impact' : undefined}
        />
        <ReputationCard reputation={reputation} />
      </div>
      <BadgeGrid badges={badges} compact={compact} />
      {!compact && <ContributionHistory onLoaded={setSummary} />}
    </div>
  );
}
