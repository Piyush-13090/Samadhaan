import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { RoomList } from '@/components/resolution/room-list';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchMyRoomsOnServer } from '@/services/resolution.service';

export const metadata: Metadata = { title: 'Resolution rooms' };

/** Every room the viewer participates in, through any of their memberships. */
export default async function ResolutionRoomsPage() {
  const rooms = await fetchMyRoomsOnServer(await requestCookieHeader());
  return (
    <PageContainer width="wide">
      <PageHeading
        title="Resolution rooms"
        description="Private collaboration between a government office and the organisation working on a problem."
      />
      <div className="mt-6">
        {rooms ? (
          <RoomList rooms={rooms} />
        ) : (
          <WorkspaceUnavailable title="We couldn't load your resolution rooms." />
        )}
      </div>
    </PageContainer>
  );
}
