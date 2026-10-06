import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TREND_RANGES, type TrendRange } from '@samadhaan/shared';
import { GovernmentDashboard } from '@/components/government/government-dashboard';
import { PageContainer } from '@/components/layout/page-container';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requestCookieHeader } from '@/lib/request-cookies';
import {
  fetchGovernmentContextOnServer,
  fetchGovernmentDashboardOnServer,
} from '@/services/government.service';

export const metadata: Metadata = { title: 'Command centre' };

export default async function GovernmentDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug } = await params;
  const { range } = await searchParams;
  const trendRange = (TREND_RANGES.find((value) => String(value) === range) ??
    30) as TrendRange;
  const header = await requestCookieHeader();

  const [context, dashboard] = await Promise.all([
    fetchGovernmentContextOnServer(slug, header),
    fetchGovernmentDashboardOnServer(slug, trendRange, header),
  ]);
  if (context.kind !== 'ok') notFound();

  return (
    <PageContainer width="wide">
      {dashboard.kind === 'ok' ? (
        <GovernmentDashboard context={context.data} data={dashboard.data} />
      ) : (
        <WorkspaceUnavailable title="We couldn't load the command centre." />
      )}
    </PageContainer>
  );
}
