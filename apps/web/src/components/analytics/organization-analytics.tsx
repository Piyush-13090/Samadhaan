'use client';

import { useState } from 'react';
import type { OrganizationAnalytics as OrganizationAnalyticsData } from '@samadhaan/shared';
import { Card, CardBody } from '@/components/ui/card';
import {
  DEFAULT_ANALYTICS_QUERY,
  isCustomIncomplete,
  toAnalyticsQuery,
  type AnalyticsQuery,
} from '@/lib/analytics';
import { fetchOrganizationAnalytics } from '@/services/analytics.service';
import { AnalyticsFilters } from './analytics-filters';
import {
  AnalyticsSection,
  DataTable,
  MetricCard,
  SeriesChart,
} from './analytics-primitives';
import { useAnalytics } from './use-analytics';

/**
 * An organisation's own delivery (Prompt 24) — visible to its members only.
 * It is never compared with or ranked against other organisations.
 */
export function OrganizationAnalytics({ slug }: { slug: string }) {
  const [query, setQuery] = useState<AnalyticsQuery>(DEFAULT_ANALYTICS_QUERY);
  const ready = !isCustomIncomplete(query);
  const key = ready ? JSON.stringify(toAnalyticsQuery(query)) : null;
  const { state, retry } = useAnalytics<OrganizationAnalyticsData>(key, (signal) =>
    fetchOrganizationAnalytics(slug, query, signal),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="type-h2 text-ink">Delivery analytics</h1>
        <p className="mt-1 max-w-2xl type-body-sm text-ink-muted">
          Your organisation’s own projects, tasks and evidence. Only your members can see
          this, and it is not compared with any other organisation.
        </p>
      </header>
      <Card>
        <CardBody>
          <AnalyticsFilters
            query={query}
            onChange={setQuery}
            showProblemFilters={false}
          />
        </CardBody>
      </Card>

      <AnalyticsSection title="Delivery" state={state} onRetry={retry}>
        {(d) => (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard metric="problemsAssigned" value={d.problemsAssigned} />
              <MetricCard metric="projectsActive" value={d.projectsActive} />
              <MetricCard metric="projectsCompleted" value={d.projectsCompleted} />
              <MetricCard
                metric="avgCompletionDays"
                value={d.avgCompletionDays}
                unit="days"
              />
              <MetricCard
                metric="onTimeRate"
                value={d.onTimeRate}
                unit="%"
                hint={`${d.onTimeObservations} with a target date`}
              />
              <MetricCard metric="tasksCompleted" value={d.tasksCompleted} />
              <MetricCard metric="openTasks" value={d.openTasks} />
              <MetricCard
                metric="evidenceApprovalRate"
                value={d.evidenceApprovalRate}
                unit="%"
              />
            </div>
            {d.trend.some((b) => b.tasksCompleted + b.projectsCompleted > 0) ? (
              <>
                <SeriesChart
                  buckets={d.trend}
                  series={[
                    {
                      key: 'tasksCompleted',
                      label: 'Tasks completed',
                      className: 'fill-primary/70 bg-primary/70',
                    },
                    {
                      key: 'projectsCompleted',
                      label: 'Projects completed',
                      className: 'fill-success bg-success',
                    },
                  ]}
                />
                <DataTable
                  visuallyHidden
                  caption="Completed work over time"
                  columns={[
                    { key: 'label', label: 'Period' },
                    { key: 'tasksCompleted', label: 'Tasks', numeric: true },
                    { key: 'projectsCompleted', label: 'Projects', numeric: true },
                  ]}
                  rows={d.trend.map((b) => ({ ...b }))}
                />
              </>
            ) : (
              <p className="type-body-sm text-ink-subtle">
                Not enough data yet — no tasks or projects were completed in this period.
              </p>
            )}
            <p className="type-caption text-ink-subtle">
              {d.governmentApprovals} resolution{d.governmentApprovals === 1 ? '' : 's'}{' '}
              approved by a government office in this period.
            </p>
          </div>
        )}
      </AnalyticsSection>
    </div>
  );
}
