import type {
  ResolutionActivityEntry,
  ResolutionParticipantSide,
  ResolutionRoomStatus,
} from '@samadhaan/shared';
import type { Tone } from '@/types/ui';

export function roomPath(roomId: string): string {
  return `/resolution/${encodeURIComponent(roomId)}`;
}

export const ROOM_STATUS_DISPLAY: Record<
  ResolutionRoomStatus,
  { label: string; tone: Tone }
> = {
  OPEN: { label: 'Active', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
};

export const SIDE_LABEL: Record<ResolutionParticipantSide, string> = {
  GOVERNMENT: 'Government',
  ORGANIZATION: 'Organisation',
};

/** "RoadSafe Foundation accepted the allocation". System activity, in words. */
export function describeRoomActivity(entry: ResolutionActivityEntry): string {
  const who = entry.actor?.name ?? 'Someone';
  switch (entry.kind) {
    case 'ALLOCATED':
      return `${entry.actor?.organizationName ?? 'The government office'} allocated the problem to ${entry.organizationName ?? 'the organisation'}`;
    case 'ACCEPTED':
      return `${entry.organizationName ?? 'The organisation'} accepted the allocation`;
    case 'ROOM_CREATED':
      return 'Resolution room created';
    case 'PARTICIPANT_JOINED':
      return `${who} joined the discussion`;
    case 'MESSAGE_SENT':
      return `${who} sent a message`;
    case 'MESSAGE_EDITED':
      return `${who} edited a message`;
    case 'MESSAGE_DELETED':
      return `${who} deleted a message`;
    case 'ATTACHMENT_ADDED':
      return `${who} added ${entry.fileName ?? 'a file'}`;
    case 'ROOM_CLOSED':
      return `${who} closed the room`;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
