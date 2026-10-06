import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OrganizationAllocationDetail } from '@/components/allocation/organization-allocation-detail';
import { PageContainer } from '@/components/layout/page-container';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchAllocationOnServer } from '@/services/allocation.service';

export const metadata: Metadata = { title: 'Allocation request' };

/** An allocation that is not this organisation's is a 404 from the API. */
export default async function WorkspaceAllocationPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const result = await fetchAllocationOnServer(slug, id, await requestCookieHeader());
  if (result.kind === 'not-found') notFound();

  return (
    <PageContainer width="wide">
      {result.kind === 'ok' ? (
        <OrganizationAllocationDetail slug={slug} allocation={result.data} />
      ) : (
        <WorkspaceUnavailable reference={result.reference} />
      )}
    </PageContainer>
  );
}
