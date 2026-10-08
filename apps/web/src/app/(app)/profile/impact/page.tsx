import type { Metadata } from 'next';
import { ImpactOverview } from '@/components/impact/impact-overview';
import { PageContainer, PageHeading } from '@/components/layout/page-container';

export const metadata: Metadata = { title: 'Your impact' };

/** Impact points, reputation, badges and the full award history. */
export default function ImpactPage() {
  return (
    <PageContainer width="narrow">
      <PageHeading
        title="Your impact"
        description="Points for confirmed civic outcomes, and a reputation for the quality of your contributions."
      />
      <div className="mt-8">
        <ImpactOverview />
      </div>
    </PageContainer>
  );
}
