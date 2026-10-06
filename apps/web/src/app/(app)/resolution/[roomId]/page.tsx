import { ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';
import { ResolutionRoom } from '@/components/resolution/resolution-room';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchRoomOnServer } from '@/services/resolution.service';

export const metadata: Metadata = { title: 'Resolution room' };

/**
 * One room, for either side. The API decides access — a room the viewer is
 * not a participant in is a 404, exactly like one that does not exist.
 */
export default async function ResolutionRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const result = await fetchRoomOnServer(roomId, await requestCookieHeader());

  if (result.kind === 'not-found') notFound();

  return (
    <PageContainer width="wide">
      {result.kind === 'ok' ? (
        <ResolutionRoom initial={result.room} />
      ) : result.kind === 'forbidden' ? (
        <Card>
          <EmptyState
            icon={ShieldAlert}
            title="This room is unavailable"
            description={result.message}
          />
        </Card>
      ) : (
        <WorkspaceUnavailable
          title="We couldn't load this resolution room."
          reference={result.reference}
        />
      )}
    </PageContainer>
  );
}
