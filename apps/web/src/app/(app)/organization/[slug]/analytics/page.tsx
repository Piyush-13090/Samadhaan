import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OrganizationAnalytics } from '@/components/analytics/organization-analytics';
import { PageContainer } from '@/components/layout/page-container';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchWorkspaceOnServer } from '@/services/workspace.service';

export const metadata: Metadata = { title: 'Analytics' };

/** An organisation's own delivery analytics — members only (Prompt 24). */
export default async function WorkspaceAnalyticsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const workspace = await fetchWorkspaceOnServer(slug, await requestCookieHeader());
  if (workspace.kind !== 'ok') notFound();
  return (
    <PageContainer width="wide">
      <OrganizationAnalytics slug={slug} />
    </PageContainer>
  );
}
