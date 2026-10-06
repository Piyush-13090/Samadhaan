import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { LoadingState } from '@/components/ui/states';
import { WorkspaceProblems } from '@/components/workspace/workspace-problems';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchWorkspaceOnServer } from '@/services/workspace.service';

export const metadata: Metadata = { title: 'Problems' };

/** Every published civic problem, filterable, most relevant to you first. */
export default async function WorkspaceProblemsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await fetchWorkspaceOnServer(slug, await requestCookieHeader());
  if (result.kind !== 'ok') notFound();

  return (
    <PageContainer width="wide">
      <PageHeading
        title="Problems"
        description="Every published civic problem. Problems in your areas of work and service area come first."
      />
      <div className="mt-6">
        <Suspense fallback={<LoadingState label="Loading problems" />}>
          <WorkspaceProblems
            slug={slug}
            scope="all"
            hasCoordinates={result.workspace.coordinates !== null}
          />
        </Suspense>
      </div>
    </PageContainer>
  );
}
