'use client';

import { ArrowLeft, ClipboardList, Lock, Radio, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RESOLUTION_CLOSE_REASON_MAX_LENGTH,
  type ResolutionActivityEntry,
  type ResolutionMessageView,
  type ResolutionParticipants,
  type ResolutionRoomView,
  type ResolutionStreamEvent,
} from '@samadhaan/shared';
import { Alert } from '@/components/ui/alert';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { projectPath } from '@/lib/project';
import { ROOM_STATUS_DISPLAY } from '@/lib/resolution';
import {
  closeRoom,
  deleteMessage,
  editMessage,
  fetchActivity,
  fetchMessages,
  fetchParticipants,
  markRoomRead,
  postMessage,
} from '@/services/resolution.service';
import { MessageComposer, type ComposerSubmit } from './message-composer';
import { ParticipantsPanel } from './participants-panel';
import { ProblemContextPanel } from './problem-context-panel';
import { ResolutionMessageList } from './resolution-message-list';
import { RoomActivity } from './room-activity';
import { useRoomStream } from './use-room-stream';

type Tab = 'messages' | 'problem' | 'people' | 'activity';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'messages', label: 'Messages' },
  { id: 'problem', label: 'Problem' },
  { id: 'people', label: 'Participants' },
  { id: 'activity', label: 'Activity' },
];

/** Sorted by (createdAt, id) — the server's order — with no duplicates. */
function merge(
  current: ResolutionMessageView[],
  incoming: ResolutionMessageView[],
): ResolutionMessageView[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * A resolution room: problem context, participants, messages and activity.
 *
 * Desktop shows context and collaboration side by side; on a phone the same
 * panels become tabs, with Messages first so the composer is one tap away.
 * Every panel stays mounted, so switching tabs never loses a draft or the
 * loaded history.
 */
export function ResolutionRoom({ initial }: { initial: ResolutionRoomView }) {
  const { toast } = useToast();
  const [room, setRoom] = useState(initial);
  const [messages, setMessages] = useState<ResolutionMessageView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [participants, setParticipants] = useState<ResolutionParticipants | null>(null);
  const [activity, setActivity] = useState<ResolutionActivityEntry[] | null>(null);
  const [tab, setTab] = useState<Tab>('messages');
  const [closing, setClosing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Where the "new messages" divider goes: the read marker when the page opened.
  const [readMarker] = useState(initial.lastReadAt);
  const open = room.status === 'OPEN';

  // Promise callbacks rather than async/await, so every state update happens
  // after the request settles, never synchronously inside an effect.
  const loadLatest = useCallback(
    () =>
      fetchMessages(room.id)
        .then((page) => {
          setMessages((current) => merge(current, page.items));
          setCursor((current) => current ?? page.nextCursor);
          setLoadError(false);
        })
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false)),
    [room.id],
  );

  const refreshActivity = useCallback(() => {
    fetchActivity(room.id)
      .then(setActivity)
      .catch(() => undefined);
  }, [room.id]);

  useEffect(() => {
    void loadLatest();
    fetchParticipants(room.id)
      .then(setParticipants)
      .catch(() => undefined);
    refreshActivity();
  }, [room.id, loadLatest, refreshActivity]);

  // Opening the room reads it. Later messages are read as they arrive while
  // the page is visible.
  const markRead = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    markRoomRead(room.id)
      .then(({ unreadCount }) => setRoom((current) => ({ ...current, unreadCount })))
      .catch(() => undefined);
  }, [room.id]);

  useEffect(() => {
    if (!loading) markRead();
  }, [loading, messages.length, markRead]);

  useEffect(() => {
    document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [markRead]);

  const mode = useRoomStream(room.id, {
    onEvent: (event: ResolutionStreamEvent) => {
      if (event.type === 'message.created' || event.type === 'message.updated') {
        setMessages((current) => merge(current, [event.message]));
      } else if (event.type === 'activity') {
        setActivity((current) =>
          current && !current.some((e) => e.id === event.entry.id)
            ? [...current, event.entry]
            : current,
        );
      } else if (event.type === 'room.closed') {
        setRoom((current) => ({
          ...current,
          status: 'CLOSED',
          closedAt: event.closedAt,
          closeReason: event.closeReason,
          viewer: { ...current.viewer, canPost: false, canClose: false },
        }));
      }
    },
    onPoll: () => {
      void loadLatest();
      refreshActivity();
    },
  });

  async function loadOlder() {
    if (!cursor) return;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(room.id, cursor);
      setMessages((current) => merge(current, page.items));
      setCursor(page.nextCursor);
    } catch {
      toast({ tone: 'danger', title: 'Could not load older messages' });
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(input: ComposerSubmit) {
    const message = await postMessage(room.id, input);
    setMessages((current) => merge(current, [message]));
  }

  async function edit(messageId: string, body: string) {
    try {
      const message = await editMessage(room.id, messageId, body);
      setMessages((current) => merge(current, [message]));
    } catch (caught) {
      throw new Error(caught instanceof ApiError ? caught.message : 'Could not save.');
    }
  }

  async function remove(messageId: string) {
    try {
      await deleteMessage(room.id, messageId);
      setMessages((current) =>
        current.map((m) =>
          m.id === messageId
            ? {
                ...m,
                body: null,
                mentions: [],
                attachments: [],
                deletedAt: new Date().toISOString(),
              }
            : m,
        ),
      );
    } catch (caught) {
      toast({
        tone: 'danger',
        title: 'Could not delete the message',
        description: caught instanceof ApiError ? caught.message : undefined,
      });
    } finally {
      setConfirmDelete(null);
    }
  }

  const allParticipants = useMemo(
    () =>
      participants
        ? [...participants.government.members, ...participants.organization.members]
        : [],
    [participants],
  );
  const status = ROOM_STATUS_DISPLAY[room.status];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={room.viewer.homePath}
            className="inline-flex items-center gap-1 type-caption font-medium text-primary underline-offset-2 hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {room.problem.publicId}
          </Link>
          <h1 className="mt-1 type-h2 text-ink">Resolution Room</h1>
          <p className="type-body-sm text-ink-muted">
            {room.government.name} · {room.organization.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone} icon={<StatusDot tone={status.tone} />}>
            {status.label}
          </Badge>
          {open && (
            <span
              className="inline-flex items-center gap-1 type-caption text-ink-subtle"
              title={
                mode === 'live'
                  ? 'New messages appear as they are sent.'
                  : 'Checking for new messages every few seconds.'
              }
            >
              {mode === 'live' ? (
                <Radio className="size-3.5" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              {mode === 'live'
                ? 'Live'
                : mode === 'connecting'
                  ? 'Connecting'
                  : 'Auto-refresh'}
            </span>
          )}
          <Button variant="secondary" size="sm" leadingIcon={<ClipboardList />} asChild>
            <Link href={projectPath(room.id)}>Project plan</Link>
          </Button>
          {room.viewer.canClose && (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Lock />}
              onClick={() => setClosing(true)}
            >
              Close room
            </Button>
          )}
        </div>
      </header>

      {room.status === 'CLOSED' && (
        <Alert tone="info" title="This room is closed">
          Closed {room.closedAt ? formatDateTime(room.closedAt) : ''}
          {room.closeReason ? ` — ${room.closeReason}` : ''}. Messages remain readable;
          nothing new can be posted.
        </Alert>
      )}

      {/* Phone: the panels as tabs. Desktop shows them all. */}
      <div
        role="tablist"
        aria-label="Room sections"
        className="flex gap-1 overflow-x-auto border-b border-border lg:hidden"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            id={`room-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`room-panel-${entry.id}`}
            onClick={() => setTab(entry.id)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 type-body-sm font-medium',
              'focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
              tab === entry.id
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {entry.label}
            {entry.id === 'messages' && room.unreadCount > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 type-overline text-ink-inverse">
                {room.unreadCount}
                <span className="sr-only"> unread</span>
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-5">
          <div
            id="room-panel-problem"
            role="tabpanel"
            aria-labelledby="room-tab-problem"
            className={cn(tab !== 'problem' && 'hidden', 'lg:block')}
          >
            <ProblemContextPanel room={room} />
          </div>
          <div
            id="room-panel-people"
            role="tabpanel"
            aria-labelledby="room-tab-people"
            className={cn(tab !== 'people' && 'hidden', 'lg:block')}
          >
            <ParticipantsPanel participants={participants} />
          </div>
        </div>

        <div
          id="room-panel-messages"
          role="tabpanel"
          aria-labelledby="room-tab-messages"
          className={cn(tab !== 'messages' && 'hidden', 'min-w-0 lg:block')}
        >
          <Card className="flex flex-col">
            <CardHeader
              title="Collaboration"
              description="Messages between the government office and the organisation."
              action={
                room.unreadCount > 0 ? (
                  <Badge tone="primary" size="sm">
                    {room.unreadCount} unread
                  </Badge>
                ) : undefined
              }
            />
            <ResolutionMessageList
              messages={messages}
              viewerId={room.viewer.userId}
              loading={loading}
              error={loadError}
              hasOlder={cursor !== null}
              loadingOlder={loadingOlder}
              readMarker={readMarker}
              canChange={open}
              onRetry={() => void loadLatest()}
              onLoadOlder={() => void loadOlder()}
              onEdit={edit}
              onDelete={(id) => setConfirmDelete(id)}
            />
            <CardBody className="border-t border-border-subtle">
              {open ? (
                <MessageComposer
                  roomId={room.id}
                  participants={allParticipants}
                  viewerId={room.viewer.userId}
                  onSubmit={send}
                />
              ) : (
                <p className="type-body-sm text-ink-muted">
                  This room is closed. New messages cannot be posted.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <section
        id="room-panel-activity"
        role="tabpanel"
        aria-labelledby="room-tab-activity"
        className={cn(tab !== 'activity' && 'hidden', 'lg:block')}
      >
        <Card>
          <CardHeader
            title="Activity"
            description="System events in this room. Not messages."
          />
          <CardBody>
            <RoomActivity entries={activity} />
          </CardBody>
        </Card>
      </section>

      <Modal
        open={confirmDelete !== null}
        onOpenChange={(value) => !value && setConfirmDelete(null)}
      >
        <ModalContent
          size="sm"
          title="Delete this message?"
          description="Participants will see “Message deleted” in its place."
          footer={
            <>
              <ModalClose asChild>
                <Button variant="secondary" size="sm">
                  Keep
                </Button>
              </ModalClose>
              <Button
                variant="danger"
                size="sm"
                onClick={() => confirmDelete && void remove(confirmDelete)}
              >
                Delete
              </Button>
            </>
          }
        />
      </Modal>

      <CloseRoomDialog
        open={closing}
        roomId={room.id}
        onClose={() => setClosing(false)}
        onClosed={(updated) => {
          setRoom(updated);
          refreshActivity();
        }}
      />
    </div>
  );
}

function CloseRoomDialog({
  open,
  roomId,
  onClose,
  onClosed,
}: {
  open: boolean;
  roomId: string;
  onClose: () => void;
  onClosed: (room: ResolutionRoomView) => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (reason.trim().length < 3) {
      setError('Give a reason for closing the room.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      onClosed(await closeRoom(roomId, reason.trim()));
      toast({
        tone: 'success',
        title: 'Room closed',
        description: 'Participants have been told.',
      });
      setReason('');
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not close the room.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(value) => !value && onClose()}>
      <ModalContent
        size="md"
        title="Close this resolution room?"
        description="Messaging stops for everyone. The history stays readable. The problem's status does not change."
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </ModalClose>
            <Button
              variant="danger"
              size="sm"
              loading={pending}
              onClick={() => void confirm()}
            >
              Close room
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          required
          hint="Shown to participants."
          error={error ?? undefined}
        >
          <Textarea
            rows={3}
            value={reason}
            maxLength={RESOLUTION_CLOSE_REASON_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </ModalContent>
    </Modal>
  );
}
