import {
  Building2,
  CheckCircle2,
  DoorOpen,
  Lock,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { ResolutionActivityEntry, ResolutionActivityKind } from '@samadhaan/shared';
import { formatDateTime } from '@/lib/format';
import { describeRoomActivity } from '@/lib/resolution';

const ICON: Record<ResolutionActivityKind, LucideIcon> = {
  ALLOCATED: Send,
  ACCEPTED: CheckCircle2,
  ROOM_CREATED: DoorOpen,
  PARTICIPANT_JOINED: UserPlus,
  MESSAGE_SENT: MessageSquare,
  MESSAGE_EDITED: Pencil,
  MESSAGE_DELETED: Trash2,
  ATTACHMENT_ADDED: Paperclip,
  ROOM_CLOSED: Lock,
};

/**
 * What happened in the room, from recorded events — never message text.
 * Newest first.
 */
export function RoomActivity({ entries }: { entries: ResolutionActivityEntry[] | null }) {
  if (entries === null) {
    return <p className="type-body-sm text-ink-muted">Loading activity…</p>;
  }
  if (entries.length === 0) {
    return <p className="type-body-sm text-ink-muted">No activity yet.</p>;
  }
  return (
    <ol className="space-y-3" aria-label="Room activity">
      {[...entries].reverse().map((entry) => {
        const Icon = ICON[entry.kind] ?? Building2;
        return (
          <li key={entry.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-subtle text-ink-subtle"
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="type-body-sm text-ink">{describeRoomActivity(entry)}</p>
              {entry.reason && (
                <p className="type-caption text-ink-muted">Reason: {entry.reason}</p>
              )}
              <p className="type-caption text-ink-subtle">
                <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
