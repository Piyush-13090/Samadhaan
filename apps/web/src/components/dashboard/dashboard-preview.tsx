import { ArrowRight, Plus } from 'lucide-react';
import Link from 'next/link';
import type {
  ImpactStat,
  NotificationSummary,
  PersonSummary,
  ProblemSummary,
} from '@/types/domain';
import { SectionHeading } from '@/components/layout/page-container';
import { ImpactMetricGroup } from '@/components/common/impact-metric';
import { NotificationItem } from '@/components/common/notification-item';
import { ProblemCard } from '@/components/problems/problem-card';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';

/**
 * Citizen dashboard.
 *
 * Every value arrives as a prop — the component performs no fetching and
 * imports no fixture. That is what makes the swap to live data a one-line
 * change in the page above it, with nothing here touched.
 */
export interface DashboardPreviewProps {
  user: PersonSummary;
  impact: ImpactStat[];
  nearbyProblems: ProblemSummary[];
  notifications: NotificationSummary[];
  /** Injected so the greeting is deterministic and testable. */
  hour?: number;
}

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPreview({
  user,
  impact,
  nearbyProblems,
  notifications,
  hour = 18,
}: DashboardPreviewProps) {
  const firstName = user.name.split(' ')[0];

  return (
    <div className="space-y-10">
      {/* Greeting + primary action */}
      <section className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="type-h1 text-ink">
            {greeting(hour)}, {firstName}.
          </h1>
          <p className="mt-2 type-body-lg text-ink-muted">
            See something that needs fixing?
          </p>
        </div>

        <Button variant="primary" size="lg" leadingIcon={<Plus />} asChild>
          <Link href="/report">Report a problem</Link>
        </Button>
      </section>

      {/* Impact */}
      <section aria-labelledby="impact-heading">
        <SectionHeading
          title="Your impact"
          description="What your reports and support have added up to."
        />
        <h2 id="impact-heading" className="sr-only">
          Your impact
        </h2>
        <ImpactMetricGroup stats={impact} className="mt-4" />
      </section>

      {/* Nearby + activity */}
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="nearby-heading">
          <SectionHeading
            title="Nearby problems"
            action={
              <Button variant="ghost" size="sm" trailingIcon={<ArrowRight />} asChild>
                <Link href="/nearby">View all</Link>
              </Button>
            }
          />
          <h2 id="nearby-heading" className="sr-only">
            Nearby problems
          </h2>

          {nearbyProblems.length === 0 ? (
            <Card className="mt-4">
              <EmptyState
                title="Nothing nearby yet"
                description="No civic problems have been reported around you."
                action={
                  <Button variant="secondary" size="sm" asChild>
                    <Link href="/explore">Explore a wider area</Link>
                  </Button>
                }
              />
            </Card>
          ) : (
            <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {nearbyProblems.map((problem) => (
                <li key={problem.id} className="flex">
                  <ProblemCard problem={problem} className="w-full" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="activity-heading">
          <Card>
            <CardHeader
              title="Recent activity"
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/notifications">All</Link>
                </Button>
              }
            />
            <h2 id="activity-heading" className="sr-only">
              Recent activity
            </h2>

            <CardBody className="p-1.5">
              {notifications.length === 0 ? (
                <EmptyState
                  size="sm"
                  title="No activity yet"
                  description="Updates on problems you follow will show up here."
                />
              ) : (
                notifications
                  .slice(0, 4)
                  .map((notification) => (
                    <NotificationItem key={notification.id} notification={notification} />
                  ))
              )}
            </CardBody>
          </Card>
        </section>
      </div>
    </div>
  );
}
