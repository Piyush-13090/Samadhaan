import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReviewList } from '@/components/government/review-list';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { LoadingState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Review queue' };

export default async function GovernmentProblemsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <PageContainer width="wide">
      <PageHeading
        title="Review queue"
        description="Reports in your jurisdiction. Review them, verify the genuine ones, and reject what is not a civic problem."
      />
      <div className="mt-6">
        <Suspense fallback={<LoadingState label="Loading reports" />}>
          <ReviewList slug={slug} />
        </Suspense>
      </div>
    </PageContainer>
  );
}
