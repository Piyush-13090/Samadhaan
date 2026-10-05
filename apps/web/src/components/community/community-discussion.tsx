'use client';

import { useCallback, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { CommentPage, CommentView } from '@samadhaan/shared';
import { CommentCard } from '@/components/common/comment-card';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { formatNumber } from '@/lib/format';
import {
  deleteComment,
  editComment,
  fetchComments,
  postComment,
} from '@/services/community.service';
import { CommentComposer } from './comment-composer';
import { useOptionalEngagement } from './engagement-context';

/**
 * Community Discussion — the comment thread on a problem page.
 *
 * Deliberately not a social feed: no reactions, no infinite scroll, no
 * nesting beyond one level of replies. It is a place to add what you know
 * about a civic problem, and the shape keeps it readable on a phone.
 *
 * Every count shown comes from the server's response to the last write; the
 * component never computes one. Writes update the thread in place from the
 * returned comment rather than refetching, so posting does not reorder or
 * re-page the thread under the reader.
 */
export function CommunityDiscussion({
  publicId,
  initial,
  acceptsEngagement = true,
}: {
  publicId: string;
  /** The first page, rendered on the server. Null when that fetch failed. */
  initial: CommentPage | null;
  acceptsEngagement?: boolean;
}) {
  const engagement = useOptionalEngagement();
  const { toast } = useToast();

  const [threads, setThreads] = useState<CommentView[]>(initial?.items ?? []);
  const [nextCursor, setNextCursor] = useState(initial?.nextCursor ?? null);
  const [status, setStatus] = useState<'ready' | 'loading' | 'error'>(
    initial ? 'ready' : 'error',
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [localCount, setLocalCount] = useState(initial?.commentCount ?? 0);
  const [announcement, setAnnouncement] = useState('');

  const commentCount = engagement?.engagement.commentCount ?? localCount;
  const open = engagement?.engagement.acceptsEngagement ?? acceptsEngagement;

  /** The server's count after a write, pushed to the header too. */
  const syncCount = useCallback(
    (count: number) => {
      setLocalCount(count);
      engagement?.setCommentCount(count);
    },
    [engagement],
  );

  async function reload() {
    setStatus('loading');
    try {
      const page = await fetchComments(publicId);
      setThreads(page.items);
      setNextCursor(page.nextCursor);
      syncCount(page.commentCount);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchComments(publicId, { cursor: nextCursor });
      // Guard against an item arriving twice if a comment was posted between
      // pages and shifted the boundary.
      setThreads((current) => {
        const seen = new Set(current.map((thread) => thread.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
      syncCount(page.commentCount);
    } catch (error) {
      notifyError("Couldn't load more comments", error);
    } finally {
      setLoadingMore(false);
    }
  }

  function notifyError(title: string, error: unknown) {
    toast({
      tone: 'danger',
      title,
      description:
        error instanceof ApiError
          ? error.message
          : 'Check your connection and try again.',
    });
  }

  // --------------------------------------------------------------- writes

  async function createTopLevel(body: string) {
    const result = await postComment(publicId, { body });
    if (result.comment) {
      const created = result.comment;
      setThreads((current) => [created, ...current]);
    }
    syncCount(result.commentCount);
    setAnnouncement('Your comment was posted.');
  }

  async function reply(parent: CommentView, body: string) {
    const result = await postComment(publicId, { body, parentCommentId: parent.id });
    const created = result.comment;
    if (created) {
      setThreads((current) =>
        current.map((thread) =>
          thread.id === parent.id
            ? {
                ...thread,
                replies: [...(thread.replies ?? []), created],
                replyCount: (thread.replyCount ?? 0) + 1,
              }
            : thread,
        ),
      );
    }
    syncCount(result.commentCount);
    setAnnouncement('Your reply was posted.');
  }

  async function edit(target: CommentView, body: string) {
    const result = await editComment(publicId, target.id, body);
    const updated = result.comment;
    if (updated) {
      setThreads((current) =>
        current.map((thread) => {
          if (thread.id === target.id) {
            // Keep the thread's own reply state; the edit response is the
            // comment alone.
            return {
              ...updated,
              replies: thread.replies,
              replyCount: thread.replyCount,
              repliesCursor: thread.repliesCursor,
            };
          }
          if (target.parentCommentId === thread.id) {
            return {
              ...thread,
              replies: thread.replies?.map((item) =>
                item.id === target.id ? updated : item,
              ),
            };
          }
          return thread;
        }),
      );
    }
    syncCount(result.commentCount);
    setAnnouncement('Your comment was updated.');
  }

  async function remove(target: CommentView) {
    try {
      const result = await deleteComment(publicId, target.id);
      setThreads((current) => removeFromThreads(current, target));
      syncCount(result.commentCount);
      setAnnouncement('The comment was deleted.');
    } catch (error) {
      notifyError("Couldn't delete the comment", error);
      throw error;
    }
  }

  async function loadMoreReplies(thread: CommentView) {
    if (!thread.repliesCursor) return;
    try {
      const page = await fetchComments(publicId, {
        parentCommentId: thread.id,
        cursor: thread.repliesCursor,
      });
      setThreads((current) =>
        current.map((item) => {
          if (item.id !== thread.id) return item;
          const seen = new Set((item.replies ?? []).map((replyItem) => replyItem.id));
          return {
            ...item,
            replies: [
              ...(item.replies ?? []),
              ...page.items.filter((replyItem) => !seen.has(replyItem.id)),
            ],
            repliesCursor: page.nextCursor,
          };
        }),
      );
    } catch (error) {
      notifyError("Couldn't load replies", error);
    }
  }

  // --------------------------------------------------------------- render

  return (
    <section
      id="discussion"
      aria-labelledby="discussion-heading"
      className="scroll-mt-24"
    >
      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id="discussion-heading" className="type-h4 text-ink">
            Community Discussion
          </h2>
          <span className="inline-flex items-center gap-1.5 type-caption text-ink-muted">
            <MessageSquare className="size-3.5" aria-hidden="true" />
            <span className="tabular">{formatNumber(commentCount)}</span>{' '}
            {commentCount === 1 ? 'comment' : 'comments'}
          </span>
        </div>

        <CardBody className="space-y-6">
          {open ? (
            <CommentComposer
              label="Add a comment"
              placeholder="Share what you know — when it started, how it affects people, anything a fixer should know."
              submitLabel="Post comment"
              onSubmit={createTopLevel}
            />
          ) : (
            <p className="type-body-sm text-ink-muted">
              Discussion is closed on this report.
            </p>
          )}

          {status === 'loading' ? (
            <CommentsSkeleton />
          ) : status === 'error' ? (
            <ErrorState
              size="sm"
              title="Couldn't load comments."
              description="The discussion could not be loaded right now."
              onRetry={() => void reload()}
            />
          ) : threads.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No comments yet."
              description="Be the first to share what you know."
            />
          ) : (
            <ol className="space-y-6" aria-label="Comments">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <CommentThread
                    thread={thread}
                    canReply={open}
                    onReply={(body) => reply(thread, body)}
                    onEdit={edit}
                    onDelete={remove}
                    onLoadMoreReplies={() => loadMoreReplies(thread)}
                  />
                </li>
              ))}
            </ol>
          )}

          {status === 'ready' && nextCursor && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                loading={loadingMore}
                onClick={() => void loadMore()}
              >
                Show more comments
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

/** A top-level comment, its controls, and its replies. */
function CommentThread({
  thread,
  canReply,
  onReply,
  onEdit,
  onDelete,
  onLoadMoreReplies,
}: {
  thread: CommentView;
  canReply: boolean;
  onReply: (body: string) => Promise<void>;
  onEdit: (comment: CommentView, body: string) => Promise<void>;
  onDelete: (comment: CommentView) => Promise<void>;
  onLoadMoreReplies: () => Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const replyFormId = `reply-${thread.id}`;

  const replies = thread.replies ?? [];
  const hiddenReplies = Math.max(0, (thread.replyCount ?? 0) - replies.length);
  const authorName = thread.author?.name;

  return (
    <div>
      <CommentItem
        comment={thread}
        onEdit={onEdit}
        onDelete={onDelete}
        extraActions={
          canReply && !thread.isRemoved ? (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={replying}
              aria-controls={replying ? replyFormId : undefined}
              onClick={() => setReplying((value) => !value)}
            >
              Reply
              {authorName && (
                <>
                  {' '}
                  <span className="sr-only">to {authorName}</span>
                </>
              )}
            </Button>
          ) : null
        }
      />

      {(replies.length > 0 || replying || hiddenReplies > 0) && (
        // Indented once, and modestly: deep indentation is what makes threads
        // unreadable on a phone.
        <div className="mt-3 ml-4 space-y-4 border-l border-border pl-3 sm:ml-11 sm:pl-4">
          {replies.length > 0 && (
            <ol
              className="space-y-4"
              aria-label={`Replies to ${authorName ?? 'a removed comment'}`}
            >
              {replies.map((reply) => (
                <li key={reply.id}>
                  <CommentItem
                    comment={reply}
                    size="sm"
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </li>
              ))}
            </ol>
          )}

          {hiddenReplies > 0 && thread.repliesCursor && (
            <Button
              variant="link"
              size="sm"
              loading={loadingReplies}
              onClick={async () => {
                setLoadingReplies(true);
                await onLoadMoreReplies();
                setLoadingReplies(false);
              }}
            >
              Show {hiddenReplies} more {hiddenReplies === 1 ? 'reply' : 'replies'}
            </Button>
          )}

          {replying && (
            <div id={replyFormId}>
              <CommentComposer
                label={authorName ? `Reply to ${authorName}` : 'Reply'}
                submitLabel="Post reply"
                autoFocus
                onSubmit={async (body) => {
                  await onReply(body);
                  setReplying(false);
                }}
                onCancel={() => setReplying(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One comment with its own edit and delete controls. */
function CommentItem({
  comment,
  size = 'md',
  extraActions,
  onEdit,
  onDelete,
}: {
  comment: CommentView;
  size?: 'sm' | 'md';
  extraActions?: React.ReactNode;
  onEdit: (comment: CommentView, body: string) => Promise<void>;
  onDelete: (comment: CommentView) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (editing && comment.body !== null) {
    return (
      <CommentCard comment={comment} size={size}>
        <div className="mt-2">
          <CommentComposer
            label="Edit your comment"
            hideLabel
            submitLabel="Save"
            initialValue={comment.body}
            autoFocus
            onSubmit={async (body) => {
              await onEdit(comment, body);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </CommentCard>
    );
  }

  const actions = (
    <>
      {extraActions}
      {comment.canEdit && (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit <span className="sr-only">your comment</span>
        </Button>
      )}
      {comment.canDelete && !confirming && (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          Delete <span className="sr-only">comment</span>
        </Button>
      )}
      {confirming && (
        <span
          role="group"
          aria-label="Confirm deletion"
          className="inline-flex flex-wrap items-center gap-2 rounded-control bg-danger-soft px-2 py-1"
        >
          <span className="type-caption text-danger">Delete this comment?</span>
          <Button
            variant="danger"
            size="sm"
            loading={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await onDelete(comment);
              } catch {
                // The thread reported the failure; leave the comment as it was.
                setDeleting(false);
                setConfirming(false);
              }
            }}
          >
            Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={deleting}
            autoFocus
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </span>
      )}
    </>
  );

  const hasActions = Boolean(extraActions) || comment.canEdit || comment.canDelete;

  return (
    <CommentCard
      comment={comment}
      size={size}
      actions={hasActions ? actions : undefined}
    />
  );
}

/** Comment-shaped skeletons, so the section holds its space while loading. */
function CommentsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading comments">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex gap-3" aria-hidden="true">
          <div className="size-8 shrink-0 animate-shimmer rounded-full bg-subtle" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 animate-shimmer rounded bg-subtle" />
            <div className="h-3 w-full animate-shimmer rounded bg-subtle" />
            <div className="h-3 w-2/3 animate-shimmer rounded bg-subtle" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Removes a deleted comment from the thread list.
 *
 * A top-level comment with replies stays as a placeholder so its replies keep
 * their place — the same rule the API applies. A removed placeholder whose last
 * reply goes is dropped, since there is nothing left for it to anchor.
 */
export function removeFromThreads(
  threads: CommentView[],
  target: CommentView,
): CommentView[] {
  if (target.parentCommentId === null) {
    return threads.flatMap((thread) => {
      if (thread.id !== target.id) return [thread];
      if ((thread.replyCount ?? 0) > 0) {
        return [
          {
            ...thread,
            body: null,
            author: null,
            isRemoved: true,
            isEdited: false,
            canEdit: false,
            canDelete: false,
          },
        ];
      }
      return [];
    });
  }

  return threads.flatMap((thread) => {
    if (thread.id !== target.parentCommentId) return [thread];
    const replies = (thread.replies ?? []).filter((reply) => reply.id !== target.id);
    const replyCount = Math.max(0, (thread.replyCount ?? 0) - 1);
    if (thread.isRemoved && replyCount === 0) return [];
    return [{ ...thread, replies, replyCount }];
  });
}
