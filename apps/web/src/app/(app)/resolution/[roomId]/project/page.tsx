import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { ProjectWorkspace } from '@/components/project/project-workspace';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchRoomProjectOnServer } from '@/services/project.service';

export const metadata: Metadata = { title: 'Resolution project' };

/**
 * The room's project. Access is the room's: a viewer who cannot enter the room
 * gets the not-found page, exactly as for a project that does not exist.
 */
export default async function ResolutionProjectPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const result = await fetchRoomProjectOnServer(roomId, await requestCookieHeader());
  if (result.kind === 'not-found') notFound();

  return (
    <PageContainer width="wide">
      {result.kind === 'ok' ? (
        <ProjectWorkspace initial={result.project} />
      ) : (
        <WorkspaceUnavailable
          title="We couldn't load this project."
          reference={result.reference}
        />
      )}
    </PageContainer>
  );
}
