'use client';

import Link from 'next/link';
import type { CitizenAnalytics } from '@samadhaan/shared';
import { fetchMyAnalytics } from '@/services/analytics.service';
import { AnalyticsSection, BarList, MetricCard } from './analytics-primitives';
import { useAnalytics } from './use-analytics';

/**
 * A citizen's own civic impact (Prompt 24): what happened to their reports.
 * Only their own records, all time.
 */
export function CitizenImpact() {
  const { state, retry } = useAnalytics<CitizenAnalytics>('me', (signal) =>
    fetchMyAnalytics(signal),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="type-h2 text-ink">My civic impact</h1>
        <p className="mt-1 max-w-2xl type-body-sm text-ink-muted">
          What has happened to the problems you reported. Points and badges are on{' '}
          <Link href="/profile/impact" className="text-primary hover:underline">
            your impact profile
          </Link>
          .
        </p>
      </header>
      <AnalyticsSection
        title="My reports"
        state={state}
        onRetry={retry}
        isEmpty={(d) => d.reported === 0}
        emptyText="You have not reported a problem yet. Your figures will appear here once you do."
      >
        {(d) => (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard metric="reported" value={d.reported} hint="All time" />
              <MetricCard metric="verified" value={d.verified} />
              <MetricCard metric="resolved" value={d.resolved} />
              <MetricCard
                metric="medianDaysToResolution"
                value={d.medianDaysToResolution}
                unit="days"
              />
            </div>
            <BarList
              label="Where my reports are now"
              rows={[
                { key: 'awaiting', label: 'Awaiting review', value: d.awaitingReview },
                {
                  key: 'verified',
                  label: 'Verified',
                  value: d.verified - d.inProgress - d.resolved,
                },
                { key: 'progress', label: 'Being worked on', value: d.inProgress },
                { key: 'resolved', label: 'Resolved', value: d.resolved },
                {
                  key: 'duplicates',
                  label: 'Confirmed duplicates',
                  value: d.confirmedDuplicates,
                },
              ]}
            />
            <p className="type-body-sm text-ink-muted">
              {d.supportersOnMyReports}{' '}
              {d.supportersOnMyReports === 1 ? 'person has' : 'people have'} supported
              your reports · {d.impactPoints} impact points earned.
            </p>
          </div>
        )}
      </AnalyticsSection>
    </div>
  );
}
