import { ArrowRight, MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import type { ResolutionRoomSummary } from '@samadhaan/shared';
import { ProblemStatusBadge } from '@/components/problems/problem-status-badge';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { formatRelativeTime } from '@/lib/format';
import { ROOM_STATUS_DISPLAY, roomPath } from '@/lib/resolution';

/** The rooms the viewer takes part in, with unread counts. */
export function RoomList({ rooms }: { rooms: ResolutionRoomSummary[] }) {
  if (rooms.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={MessagesSquare}
          title="No resolution rooms yet"
          description="A room opens when an organisation accepts a government allocation. Both sides collaborate there."
        />
      </Card>
    );
  }
  return (
    <ul className="space-y-3">
      {rooms.map((room) => {
        const status = ROOM_STATUS_DISPLAY[room.status];
        return (
          <li key={room.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono type-caption text-ink-subtle">
                  {room.problem.publicId}
                </span>
                <Badge
                  tone={status.tone}
                  size="sm"
                  icon={<StatusDot tone={status.tone} />}
                >
                  {status.label}
                </Badge>
                <ProblemStatusBadge status={room.problem.status} size="sm" />
                {room.unreadCount > 0 && (
                  <Badge tone="primary" size="sm">
                    {room.unreadCount} unread
                  </Badge>
                )}
              </div>
              <h2 className="mt-2 type-body font-semibold text-ink">
                <Link
                  href={roomPath(room.id)}
                  className="underline-offset-2 hover:underline"
                >
                  {room.problem.title}
                </Link>
              </h2>
              <p className="mt-1 type-caption text-ink-muted">
                {room.government.name} · {room.organization.name}
                {room.lastMessageAt &&
                  ` · Last message ${formatRelativeTime(room.lastMessageAt)}`}
              </p>
              <Link
                href={roomPath(room.id)}
                className="mt-3 inline-flex items-center gap-1 type-body-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                Open room<span className="sr-only">: {room.problem.title}</span>
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
