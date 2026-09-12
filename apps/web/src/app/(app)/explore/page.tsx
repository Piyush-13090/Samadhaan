import { SlidersHorizontal } from 'lucide-react';
import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { ProblemCard } from '@/components/problems/problem-card';
import { Button } from '@/components/ui/button';
import { PROBLEMS } from '@/data/problems';

export const metadata: Metadata = { title: 'Explore' };

/**
 * Problem feed.
 *
 * Layout and card rendering only — filtering, sorting and pagination arrive
 * with the problem reporting milestone, when there is a real query to drive.
 */
export default function ExplorePage() {
  return (
    <PageContainer width="wide">
      <PageHeading
        title="Explore problems"
        description="Everything reported across the city, newest first."
        action={
          <Button variant="secondary" leadingIcon={<SlidersHorizontal />} disabled>
            Filters
          </Button>
        }
      />

      <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {PROBLEMS.map((problem) => (
          <li key={problem.id} className="flex">
            <ProblemCard problem={problem} className="w-full" />
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
