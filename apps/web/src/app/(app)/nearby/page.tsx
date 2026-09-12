import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { LocationCard } from '@/components/problems/location-card';
import { ProblemCard } from '@/components/problems/problem-card';
import { NEARBY_PROBLEMS } from '@/data/problems';

export const metadata: Metadata = { title: 'Nearby' };

export default function NearbyPage() {
  return (
    <PageContainer width="wide">
      <PageHeading
        title="Nearby"
        description="Problems reported close to you, nearest first."
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ul className="grid gap-4 md:grid-cols-2">
          {NEARBY_PROBLEMS.map((problem) => (
            <li key={problem.id} className="flex">
              <ProblemCard problem={problem} className="w-full" />
            </li>
          ))}
        </ul>

        <LocationCard location={NEARBY_PROBLEMS[0]!.location} className="h-fit" />
      </div>
    </PageContainer>
  );
}
