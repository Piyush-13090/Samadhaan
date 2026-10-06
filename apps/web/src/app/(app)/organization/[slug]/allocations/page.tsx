import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ALLOCATION_VIEWS, type AllocationView } from '@samadhaan/shared';
import { OrganizationAllocationList } from '@/components/allocation/organization-allocation-list';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchAllocationsOnServer } from '@/services/allocation.service';
import { fetchWorkspaceOnServer } from '@/services/workspace.service';

export const metadata: Metadata = { title: 'Allocations' };

/**
 * Problems government offices have allocated to this organisation. Every
 * member may read; owners and admins respond on the detail page.
 */
export default async function WorkspaceAllocationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const view: AllocationView = (ALLOCATION_VIEWS as readonly string[]).includes(
    query.view ?? '',
  )
    ? (query.view as AllocationView)
    : 'pending';
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);

  const header = await requestCookieHeader();
  const [workspace, result] = await Promise.all([
    fetchWorkspaceOnServer(slug, header),
    fetchAllocationsOnServer(slug, { view, page }, header),
  ]);
  if (workspace.kind !== 'ok' || result.kind === 'not-found') notFound();

  return (
    <PageContainer width="wide">
      <PageHeading
        title="Allocations"
        description="Verified problems a government office has asked your organisation to take on."
      />
      <div className="mt-6">
        {result.kind === 'ok' ? (
          <OrganizationAllocationList slug={slug} view={view} data={result.data} />
        ) : (
          <WorkspaceUnavailable reference={result.reference} />
        )}
      </div>
    </PageContainer>
  );
}
