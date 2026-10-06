import { ArrowRight, ClipboardCheck, History, Map as MapIcon, Send } from 'lucide-react';
import Link from 'next/link';
import {
  TREND_RANGES,
  type GovernmentContext,
  type GovernmentDashboard as GovernmentDashboardData,
} from '@samadhaan/shared';
import type { ImpactStat } from '@/types/domain';
import { ImpactMetricGroup } from '@/components/common/impact-metric';
import { SectionHeading } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { governmentPath } from '@/lib/government';
import { greeting } from '@/lib/greeting';
import { AuditTimeline } from './audit-timeline';
import { CivicTrendChart } from './civic-trend-chart';
import { JurisdictionBadge } from './jurisdiction-badge';
import { ReviewQueueItem } from './review-queue-item';

/**
 * The civic intelligence command centre.
 *
 * Every number is counted in the database, inside this office's
 * jurisdiction. The review queue is the most severe, longest-waiting reports;
 * activity is the audit log. Nothing here allocates work — that arrives with
 * the allocation workflow.
 */
export function GovernmentDashboard({
  context,
  data,
  hour,
}: {
  context: GovernmentContext;
  data: GovernmentDashboardData;
  hour?: number;
}) {
  const slug = context.organization.slug;
  const { metrics } = data;

  const stats: ImpactStat[] = [
    {
      id: 'total',
      label: 'Total reports',
      value: metrics.totalReports,
      hint: 'Published reports in your jurisdiction.',
    },
    {
      id: 'pending',
      label: 'Pending review',
      value: metrics.pendingReview,
      hint: `${metrics.submitted} submitted, ${metrics.underReview} under review.`,
    },
    {
      id: 'verified',
      label: 'Verified',
      value: metrics.verified,
      hint: 'Confirmed by review, not yet accepted by an organisation.',
    },
    {
      id: 'high',
      label: 'High or critical',
      value: metrics.highSeverityOpen,
      hint: 'Open reports rated high or critical severity.',
    },
    {
      id: 'progress',
      label: 'In progress',
      value: metrics.inProgress,
      hint: 'Being worked on.',
    },
    {
      id: 'resolved',
      label: 'Resolved',
      value: metrics.resolved,
      hint: 'Marked resolved.',
    },
  ];

  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <p className="type-overline text-primary">Civic Intelligence Command Center</p>
          <h1 className="mt-1.5 type-h1 text-ink">
            {greeting(hour)}, {context.viewer.firstName}.
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 type-body-lg text-ink-muted">
            {context.organization.name}
            <JurisdictionBadge jurisdiction={context.organization.jurisdiction} />
          </p>
        </div>
        <Button variant="primary" size="lg" leadingIcon={<ClipboardCheck />} asChild>
          <Link href={governmentPath(slug, 'problems')}>Open review queue</Link>
        </Button>
      </section>

      <section aria-labelledby="gov-overview">
        <h2 id="gov-overview" className="sr-only">
          Overview
        </h2>
        <ImpactMetricGroup stats={stats} className="sm:grid-cols-3 xl:grid-cols-6" />
      </section>

      <Card as="section" aria-label="Reports over time">
        <CardHeader
          title="Reports over time"
          description={`New reports and resolutions per day, last ${data.trend.rangeDays} days.`}
          action={
            <nav
              aria-label="Trend range"
              className="inline-flex rounded-control border border-border p-0.5"
            >
              {TREND_RANGES.map((range) => (
                <Link
                  key={range}
                  href={`${governmentPath(slug)}?range=${range}`}
                  scroll={false}
                  aria-current={range === data.trend.rangeDays ? 'true' : undefined}
                  className={cn(
                    'rounded-[6px] px-2.5 py-1 type-caption',
                    range === data.trend.rangeDays
                      ? 'bg-primary-soft font-medium text-primary'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {range} days
                </Link>
              ))}
            </nav>
          }
        />
        <CardBody>
          <CivicTrendChart points={data.trend.points} />
        </CardBody>
      </Card>

      <div className="grid gap-8 lg:grid-cols-3">
        <section aria-label="Needs review" className="lg:col-span-2">
          <SectionHeading
            title="Needs review"
            description="Most severe first; within a severity, the longest waiting."
            action={
              <Button variant="ghost" size="sm" trailingIcon={<ArrowRight />} asChild>
                <Link href={governmentPath(slug, 'problems')}>
                  All {metrics.pendingReview}
                </Link>
              </Button>
            }
          />
          {data.reviewQueue.length === 0 ? (
            <Card className="mt-4">
              <EmptyState
                icon={ClipboardCheck}
                title="Nothing waiting for review"
                description="New reports in your jurisdiction will appear here."
              />
            </Card>
          ) : (
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {data.reviewQueue.map((item) => (
                <li key={item.publicId} className="flex">
                  <ReviewQueueItem slug={slug} item={item} className="w-full" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Allocations"
              description="Requests your office has sent to organisations."
              icon={<Send className="size-4" />}
            />
            <CardBody>
              <dl className="grid grid-cols-3 gap-3 type-caption">
                <div>
                  <dt className="text-ink-muted">Awaiting response</dt>
                  <dd className="tabular type-body font-semibold text-ink">
                    {metrics.pendingAllocations}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Accepted</dt>
                  <dd className="tabular type-body font-semibold text-ink">
                    {metrics.acceptedAllocations}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Declined</dt>
                  <dd className="tabular type-body font-semibold text-ink">
                    {metrics.declinedAllocations}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Jurisdiction map"
              description="Every report in your area, clustered by location."
              icon={<MapIcon className="size-4" />}
            />
            <CardBody className="space-y-3">
              <dl className="grid grid-cols-2 gap-3 type-caption">
                <div>
                  <dt className="text-ink-muted">Rejected</dt>
                  <dd className="tabular type-body font-semibold text-ink">
                    {metrics.rejected}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Duplicates</dt>
                  <dd className="tabular type-body font-semibold text-ink">
                    {metrics.duplicates}
                  </dd>
                </div>
              </dl>
              <Button variant="secondary" size="sm" leadingIcon={<MapIcon />} asChild>
                <Link href={governmentPath(slug, 'map')}>Open the map</Link>
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent activity"
              description="From the audit log."
              icon={<History className="size-4" />}
            />
            <CardBody>
              {data.recentActivity.length === 0 ? (
                <p className="type-body-sm text-ink-muted">No review activity yet.</p>
              ) : (
                <AuditTimeline entries={data.recentActivity} />
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
