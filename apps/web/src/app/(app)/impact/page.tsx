import type { Metadata } from 'next';
import { CitizenImpact } from '@/components/analytics/citizen-impact';
import { PageContainer } from '@/components/layout/page-container';

export const metadata: Metadata = { title: 'My impact' };

/** A citizen's own civic impact dashboard (Prompt 24). */
export default function ImpactPage() {
  return (
    <PageContainer>
      <CitizenImpact />
    </PageContainer>
  );
}
