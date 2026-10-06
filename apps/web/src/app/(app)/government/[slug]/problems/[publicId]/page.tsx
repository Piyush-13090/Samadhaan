import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GovernmentProblemView } from '@/components/government/government-problem-view';
import { PageContainer } from '@/components/layout/page-container';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requestCookieHeader } from '@/lib/request-cookies';
import {
  fetchGovernmentContextOnServer,
  fetchGovernmentProblemOnServer,
} from '@/services/government.service';

export const metadata: Metadata = { title: 'Review' };

/**
 * A problem under review. Outside the jurisdiction it is the not-found page —
 * the same answer as for a problem that does not exist.
 */
export default async function GovernmentProblemPage({
  params,
}: {
  params: Promise<{ slug: string; publicId: string }>;
}) {
  const { slug, publicId } = await params;
  const header = await requestCookieHeader();
  const [context, detail] = await Promise.all([
    fetchGovernmentContextOnServer(slug, header),
    fetchGovernmentProblemOnServer(slug, publicId, header),
  ]);
  if (context.kind !== 'ok' || detail.kind === 'not-found') notFound();

  return (
    <PageContainer width="wide">
      {detail.kind === 'ok' ? (
        <GovernmentProblemView context={context.data} detail={detail.data} />
      ) : (
        <WorkspaceUnavailable title="We couldn't load this report." />
      )}
    </PageContainer>
  );
}
