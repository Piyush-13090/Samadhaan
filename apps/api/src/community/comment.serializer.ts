import type { CommentView, UserRole } from '@samadhaan/shared';

/** The author columns a thread may read. Selected explicitly, never `include: true`. */
export const COMMENT_AUTHOR_SELECT = {
  id: true,
  fullName: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  deletedAt: true,
} as const;

export interface CommentRow {
  id: string;
  problemId: string;
  userId: string;
  parentCommentId: string | null;
  body: string;
  isEdited: boolean;
  createdAt: Date;
  deletedAt: Date | null;
  user: {
    id: string;
    fullName: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: string;
    deletedAt: Date | null;
  };
}

export interface CommentViewContext {
  viewerId: string | null;
  viewerIsAdmin: boolean;
  /** The problem's reporter, so their comments can be marked. */
  reporterId: string;
}

/**
 * The only comment shape the API emits.
 *
 * An allow-list, as everywhere else. Two rules matter most:
 *
 *  - **A removed comment carries nothing.** Its body and author are dropped
 *    here, at the one place every response passes through, so no endpoint can
 *    forget to. It stays in the thread only to keep its replies in place.
 *  - **The author is a name and an avatar.** Never the email, never the account
 *    state. A citizen who comments in public has not thereby published their
 *    contact details.
 *
 * `canEdit`/`canDelete` drive which controls the UI shows. They are a courtesy;
 * the service re-checks ownership on every write.
 */
export function toCommentView(row: CommentRow, context: CommentViewContext): CommentView {
  const removed = row.deletedAt !== null;
  const own = context.viewerId !== null && row.userId === context.viewerId;

  return {
    id: row.id,
    body: removed ? null : row.body,
    author: removed
      ? null
      : {
          id: row.user.id,
          // A departed account keeps its words on the public record — they are
          // part of the problem's history — but not its name.
          name: row.user.deletedAt
            ? 'Former member'
            : (row.user.displayName ?? row.user.fullName),
          avatarUrl: row.user.deletedAt ? null : row.user.avatarUrl,
          role: row.user.role as UserRole,
          isReporter: row.userId === context.reporterId,
        },
    parentCommentId: row.parentCommentId,
    createdAt: row.createdAt.toISOString(),
    isEdited: !removed && row.isEdited,
    isRemoved: removed,
    canEdit: !removed && own,
    canDelete: !removed && (own || context.viewerIsAdmin),
  };
}
