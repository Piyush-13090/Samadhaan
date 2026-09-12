import { FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { ProgressTimeline } from '@/components/problems/progress-timeline';
import { ResolutionStatus } from '@/components/problems/resolution-status';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FEATURED_PROBLEM, PROBLEM_TIMELINE } from '@/data/problems';

export const metadata: Metadata = { title: 'My problems' };

/**
 * The user's own reports.
 *
 * Doubles as the reference composition for the problem detail view: resolution
 * status, timeline and the empty state a new account sees.
 */
export default function MyProblemsPage() {
  return (
    <PageContainer>
      <PageHeading
        title="My problems"
        description="Everything you have reported, and where it has got to."
        action={
          <Button variant="primary" leadingIcon={<Plus />} asChild>
            <Link href="/report">Report a problem</Link>
          </Button>
        }
      />

      <Tabs defaultValue="active" className="mt-8">
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Card>
              <CardHeader
                title={FEATURED_PROBLEM.title}
                description={FEATURED_PROBLEM.location.address}
              />
              <CardBody>
                <ProgressTimeline events={PROBLEM_TIMELINE} />
              </CardBody>
            </Card>

            <ResolutionStatus
              status={FEATURED_PROBLEM.status}
              progress={FEATURED_PROBLEM.progress}
              className="h-fit"
            />
          </div>
        </TabsContent>

        <TabsContent value="resolved">
          <Card>
            <EmptyState
              icon={FileText}
              title="No resolved problems yet"
              description="Problems you reported will appear here once they have been fixed and verified."
              action={
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/explore">Explore problems</Link>
                </Button>
              }
            />
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
