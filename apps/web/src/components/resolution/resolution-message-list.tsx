'use client';

import { MessageSquare } from 'lucide-react';
import { Fragment, useEffect, useRef } from 'react';
import type { ResolutionMessageView } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Spinner } from '@/components/ui/spinner';
import { ResolutionMessage } from './resolution-message';

/**
 * The conversation, oldest at the top. A polite live region announces new
 * messages to screen readers; the list scrolls to the newest message when one
 * arrives, unless the reader has scrolled up to read history.
 */
export function ResolutionMessageList({
  messages,
  viewerId,
  loading,
  error,
  hasOlder,
  loadingOlder,
  readMarker,
  canChange,
  onRetry,
  onLoadOlder,
  onEdit,
  onDelete,
}: {
  messages: ResolutionMessageView[];
  viewerId: string;
  loading: boolean;
  error: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  /** Messages after this, from others, were unread when the room opened. */
  readMarker: string | null;
  canChange: boolean;
  onRetry: () => void;
  onLoadOlder: () => void;
  onEdit: (messageId: string, body: string) => Promise<void>;
  onDelete: (messageId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [lastId]);

  const firstUnread = messages.find(
    (m) =>
      m.author.userId !== viewerId &&
      m.deletedAt === null &&
      (readMarker === null || m.createdAt > readMarker),
  )?.id;
  const latest = messages.at(-1);

  return (
    <div
      ref={scroller}
      onScroll={(event) => {
        const el = event.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="max-h-[60vh] min-h-64 overflow-y-auto px-3 py-3 lg:max-h-[34rem]"
    >
      {loading ? (
        <div className="grid h-48 place-items-center">
          <Spinner label="Loading messages" />
        </div>
      ) : error && messages.length === 0 ? (
        <ErrorState
          size="sm"
          title="Messages could not be loaded"
          description="Check your connection and try again."
          onRetry={onRetry}
        />
      ) : messages.length === 0 ? (
        <EmptyState
          size="sm"
          icon={MessageSquare}
          title="No messages yet"
          description="Start the conversation — introduce your team or share the plan for this problem."
        />
      ) : (
        <>
          {hasOlder && (
            <div className="mb-2 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                loading={loadingOlder}
                onClick={onLoadOlder}
              >
                Load earlier messages
              </Button>
            </div>
          )}
          <ol className="space-y-1" aria-label="Messages">
            {messages.map((message) => (
              <Fragment key={message.id}>
                {message.id === firstUnread && (
                  <li
                    aria-hidden="false"
                    className="my-2 flex items-center gap-2 type-caption font-medium text-primary"
                  >
                    <span className="h-px flex-1 bg-primary/40" />
                    New messages
                    <span className="h-px flex-1 bg-primary/40" />
                  </li>
                )}
                <li>
                  <ResolutionMessage
                    message={message}
                    isOwn={message.author.userId === viewerId}
                    canChange={canChange}
                    onEdit={(body) => onEdit(message.id, body)}
                    onDelete={() => onDelete(message.id)}
                  />
                </li>
              </Fragment>
            ))}
          </ol>
        </>
      )}
      <p className="sr-only" aria-live="polite">
        {latest && latest.author.userId !== viewerId && latest.deletedAt === null
          ? `New message from ${latest.author.name}`
          : ''}
      </p>
    </div>
  );
}
