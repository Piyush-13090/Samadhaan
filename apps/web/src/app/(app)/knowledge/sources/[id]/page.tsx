import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SourceDetail } from '@/components/knowledge/source-detail';
import { PageContainer } from '@/components/layout/page-container';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchSourceOnServer } from '@/services/knowledge.service';

export const metadata: Metadata = { title: 'Knowledge source' };

/**
 * One knowledge source and its passages. A source the viewer may not read
 * gets the not-found page, exactly as one that does not exist.
 */
export default async function KnowledgeSourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await fetchSourceOnServer(id, await requestCookieHeader());
  if (result.kind === 'not-found') notFound();

  return (
    <PageContainer width="wide">
      {result.kind === 'ok' ? (
        <SourceDetail initial={result.source} />
      ) : (
        <WorkspaceUnavailable
          title="We couldn't load this source."
          reference={result.reference}
        />
      )}
    </PageContainer>
  );
}
