import type { Metadata } from 'next';
import { GovernmentAnalytics } from '@/components/analytics/government-analytics';
import { PageContainer } from '@/components/layout/page-container';

export const metadata: Metadata = { title: 'Civic analytics' };

/**
 * The office's analytics (Prompt 24). The portal layout has already proven
 * membership; every section asks the API again, which applies the
 * jurisdiction.
 */
export default async function GovernmentAnalyticsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <PageContainer width="wide">
      <GovernmentAnalytics slug={slug} />
    </PageContainer>
  );
}
