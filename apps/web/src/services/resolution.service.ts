import type {
  ResolutionActivityEntry,
  ResolutionAttachmentView,
  ResolutionMessagePage,
  ResolutionMessageView,
  ResolutionParticipants,
  ResolutionRoomSummary,
  ResolutionRoomView,
} from '@samadhaan/shared';
import { api, createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Resolution room calls (Prompt 17). Nothing here names the author, the room's
 * organisations or the viewer's side — the API derives all of them from the
 * session and its own membership checks.
 */

const base = (roomId: string) => `/resolution-rooms/${encodeURIComponent(roomId)}`;

function serverOptions(cookieHeader: string) {
  return {
    cache: 'no-store' as const,
    headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
  };
}

export type RoomResult =
  | { kind: 'ok'; room: ResolutionRoomView }
  | { kind: 'not-found' }
  | { kind: 'forbidden'; message: string }
  | { kind: 'error'; reference?: string };

export async function fetchRoomOnServer(
  roomId: string,
  cookieHeader: string,
): Promise<RoomResult> {
  try {
    return {
      kind: 'ok',
      room: await createServerApi().get<ResolutionRoomView>(
        base(roomId),
        serverOptions(cookieHeader),
      ),
    };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      return { kind: 'not-found' };
    }
    if (error instanceof ApiError && error.status === 403) {
      return { kind: 'forbidden', message: error.message };
    }
    return {
      kind: 'error',
      reference: error instanceof ApiError ? error.requestId : undefined,
    };
  }
}

export async function fetchMyRoomsOnServer(
  cookieHeader: string,
): Promise<ResolutionRoomSummary[] | null> {
  try {
    return await createServerApi().get<ResolutionRoomSummary[]>(
      '/resolution-rooms',
      serverOptions(cookieHeader),
    );
  } catch {
    return null;
  }
}

export function fetchRoom(roomId: string): Promise<ResolutionRoomView> {
  return api.get<ResolutionRoomView>(base(roomId), { cache: 'no-store' });
}

export function fetchParticipants(roomId: string): Promise<ResolutionParticipants> {
  return api.get<ResolutionParticipants>(`${base(roomId)}/participants`, {
    cache: 'no-store',
  });
}

export function fetchMessages(
  roomId: string,
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<ResolutionMessagePage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return api.get<ResolutionMessagePage>(`${base(roomId)}/messages${query}`, {
    cache: 'no-store',
    signal,
  });
}

export function fetchActivity(roomId: string): Promise<ResolutionActivityEntry[]> {
  return api.get<ResolutionActivityEntry[]>(`${base(roomId)}/activity`, {
    cache: 'no-store',
  });
}

export function postMessage(
  roomId: string,
  input: { body: string; mentionUserIds?: string[]; attachmentIds?: string[] },
): Promise<ResolutionMessageView> {
  return api.post<ResolutionMessageView>(`${base(roomId)}/messages`, input);
}

export function editMessage(
  roomId: string,
  messageId: string,
  body: string,
): Promise<ResolutionMessageView> {
  return api.patch<ResolutionMessageView>(
    `${base(roomId)}/messages/${encodeURIComponent(messageId)}`,
    { body },
  );
}

export function deleteMessage(roomId: string, messageId: string): Promise<void> {
  return api.delete<void>(`${base(roomId)}/messages/${encodeURIComponent(messageId)}`);
}

export function markRoomRead(roomId: string): Promise<{ unreadCount: number }> {
  return api.post<{ unreadCount: number }>(`${base(roomId)}/read`);
}

export function closeRoom(roomId: string, reason: string): Promise<ResolutionRoomView> {
  return api.post<ResolutionRoomView>(`${base(roomId)}/close`, { reason });
}

/** Multipart, so not through the JSON client. Same envelope on the way back. */
export async function uploadAttachment(
  roomId: string,
  file: File,
): Promise<ResolutionAttachmentView> {
  const body = new FormData();
  body.append('file', file);
  let response: Response;
  try {
    response = await fetch(`/api/v1${base(roomId)}/attachments`, {
      method: 'POST',
      body,
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
  } catch {
    throw ApiError.network('Could not reach Samadhaan. Check your connection.');
  }
  const payload = (await response.json().catch(() => null)) as
    | { success: true; data: ResolutionAttachmentView }
    | { success: false; error: { code: string; message: string } }
    | null;
  if (!payload || !payload.success) {
    throw new ApiError({
      code: (payload && !payload.success
        ? payload.error.code
        : 'INTERNAL_ERROR') as ApiError['code'],
      message:
        payload && !payload.success
          ? payload.error.message
          : 'The upload failed. Please try again.',
      status: response.status,
    });
  }
  return payload.data;
}

/** The room's event stream URL — same origin, so the session cookie goes with it. */
export function roomStreamUrl(roomId: string): string {
  return `/api/v1${base(roomId)}/stream`;
}
