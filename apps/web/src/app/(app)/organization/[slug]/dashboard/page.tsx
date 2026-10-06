import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { OrganizationDashboard } from '@/components/workspace/organization-dashboard';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requestCookieHeader } from '@/lib/request-cookies';
import {
  fetchWorkspaceDashboardOnServer,
  fetchWorkspaceOnServer,
} from '@/services/workspace.service';

export const metadata: Metadata = { title: 'Organisation dashboard' };

/**
 * The organisation's home. One API call for the whole dashboard; the workspace
 * itself is shared with the layout's request through React `cache`.
 */
export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const header = await requestCookieHeader();

  const [result, data] = await Promise.all([
    fetchWorkspaceOnServer(slug, header),
    fetchWorkspaceDashboardOnServer(slug, header),
  ]);
  // The layout has already rendered anything but a workspace.
  if (result.kind !== 'ok') notFound();

  return (
    <PageContainer width="wide">
      {data ? (
        <OrganizationDashboard workspace={result.workspace} data={data} />
      ) : (
        <WorkspaceUnavailable />
      )}
    </PageContainer>
  );
}
