import { ArrowRight, FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import type { CitizenDashboard as CitizenDashboardData } from '@samadhaan/shared';
import type { ImpactStat } from '@/types/domain';
import { SectionHeading } from '@/components/layout/page-container';
import { ImpactMetricGroup } from '@/components/common/impact-metric';
import { NearbyProblems } from '@/components/discovery/nearby-problems';
import { ProblemListCard } from '@/components/problems/problem-list-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';

/**
 * The citizen home page.
 *
 * Everything except the nearby feed arrives as a prop from one server-rendered
 * request, so the page paints complete. The nearby section is the one part that
 * cannot be: it needs a location only the browser knows, so it mounts on the
 * client and fills in.
 *
 * Every number here is counted from the database. The one metric with no
 * system behind it — impact points — renders as a dash and says "coming soon"
 * rather than a zero that would read as a measured score.
 */
export function CitizenDashboard({
  data,
  hour,
}: {
  data: CitizenDashboardData;
  /** Injected so the greeting is deterministic and testable. */
  hour?: number;
}) {
  const { user, activity, recentReports, reportCount } = data;

  const impact: ImpactStat[] = [
    {
      id: 'reported',
      label: 'Problems reported',
      value: activity.problemsReported,
      hint: 'Civic problems you have filed.',
    },
    {
      id: 'supported',
      label: 'Problems supported',
      value: activity.problemsSupported,
      hint: 'Reports from others you have backed.',
    },
    {
      id: 'resolved',
      label: 'Resolved',
      value: activity.problemsResolved,
      hint: 'Problems you contributed to that have been fixed.',
    },
    {
      id: 'impact',
      label: 'Impact points',
      // Null from the API means the ledger does not exist yet, which the metric
      // renders as a dash. The `?? 0` only satisfies the type — `pending` is
      // what decides whether a number is shown at all.
      value: activity.impactPoints ?? 0,
      pending: activity.impactPoints === null,
      hint: 'Recognition for civic contribution. Arriving in a later release.',
    },
  ];

  return (
    <div className="space-y-10">
      {/* Greeting + primary action */}
      <section className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="type-h1 text-ink">
            {greeting(hour)}, {user.firstName}.
          </h1>
          <p className="mt-2 type-body-lg text-ink-muted">
            Here&rsquo;s what&rsquo;s happening around your community.
          </p>
        </div>

        <Button variant="primary" size="lg" leadingIcon={<Plus />} asChild>
          <Link href="/report">Report a problem</Link>
        </Button>
      </section>

      <section aria-label="Your impact">
        <SectionHeading
          title="Your impact"
          description="What your reports and support have added up to."
        />
        <ImpactMetricGroup stats={impact} className="mt-4" />
      </section>

      <section aria-label="Nearby problems">
        <SectionHeading
          title="Nearby problems"
          description="Civic issues reported around you, most relevant first."
          action={
            <Button variant="ghost" size="sm" trailingIcon={<ArrowRight />} asChild>
              <Link href="/explore">Explore all</Link>
            </Button>
          }
        />

        <NearbyProblems profileCity={user.city} className="mt-4" limit={6} />
      </section>

      <section aria-label="Your reports">
        <SectionHeading
          title="Your reports"
          description={
            reportCount > 0
              ? `${reportCount} ${reportCount === 1 ? 'report' : 'reports'} filed.`
              : undefined
          }
          action={
            reportCount > recentReports.length ? (
              <Button variant="ghost" size="sm" trailingIcon={<ArrowRight />} asChild>
                <Link href="/my-problems">View all</Link>
              </Button>
            ) : undefined
          }
        />

        {recentReports.length === 0 ? (
          <Card className="mt-4">
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
          </Card>
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {recentReports.map((problem) => (
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
      </section>
    </div>
  );
}

/**
 * Time-aware greeting.
 *
 * Resolved on the server from the server's clock, which is close enough: every
 * user of this deployment is in one timezone, and a greeting is not worth
 * shipping a client-side hydration boundary for.
 */
function greeting(hour = new Date().getHours()): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
