import type { UserRole } from './roles.js';

/**
 * Community contracts — support, follow and discussion.
 *
 * Two deliberately separate signals:
 *
 *  - **Support** — "I believe this issue matters." A public, counted claim that
 *    later feeds priority and civic impact.
 *  - **Follow** — "I want to keep track of this issue." A private subscription
 *    that later drives notifications. It says nothing about importance.
 *
 * Conflating them would make every notification subscriber look like an
 * endorsement, and every endorsement opt into notifications.
 *
 * Every count here is read from the server. The client never sends one, and no
 * request can name a user — identity always comes from the session.
 */

// ---------------------------------------------------------------------------
// Limits — one definition for the DTOs, the database CHECK and the UI.
// ---------------------------------------------------------------------------

/** Shortest comment worth posting. Stops "." and "k" without being fussy. */
export const COMMENT_BODY_MIN_LENGTH = 2;

/**
 * Longest comment accepted. Matches the `problem_comments_body_length` CHECK,
 * so the database refuses what the API would — whichever runs first.
 */
export const COMMENT_BODY_MAX_LENGTH = 2000;

/** Top-level comments per page. */
export const COMMENTS_PAGE_SIZE = 20;

/** Replies shown under each comment before "show more replies". */
export const REPLY_PREVIEW_COUNT = 3;

// ---------------------------------------------------------------------------
// Support and follow
// ---------------------------------------------------------------------------

export interface SupportState {
  supportCount: number;
  /** False for an anonymous viewer. */
  supportedByCurrentUser: boolean;
}

export interface FollowState {
  followerCount: number;
  /** False for an anonymous viewer. */
  followedByCurrentUser: boolean;
}

/**
 * Everything the problem page header needs about community engagement, in one
 * read. `commentCount` counts comments that have not been removed.
 */
export interface ProblemEngagement extends SupportState, FollowState {
  commentCount: number;
  /**
   * False when the problem no longer accepts engagement — a confirmed
   * duplicate, whose supporters belong on the canonical report.
   */
  acceptsEngagement: boolean;
  /** The canonical report's public id, when this one is a duplicate of it. */
  duplicateOfPublicId: string | null;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/** A comment author at the privacy level a public thread may show. */
export interface CommentAuthor {
  id: string;
  /** Display name where set, otherwise full name. Never the email. */
  name: string;
  avatarUrl: string | null;
  role: UserRole;
  /** True when the author filed the problem being discussed. */
  isReporter: boolean;
}

export interface CommentView {
  id: string;
  /** Null when the comment has been removed. */
  body: string | null;
  /** Null when the comment has been removed. */
  author: CommentAuthor | null;
  parentCommentId: string | null;
  createdAt: string;
  isEdited: boolean;
  /**
   * A removed comment is kept in the thread only to hold its replies in place.
   * Its body and author are never sent.
   */
  isRemoved: boolean;

  /** Server-computed. The UI shows controls from these; the API still checks. */
  canEdit: boolean;
  canDelete: boolean;

  /**
   * The first few replies, oldest first. Present on top-level comments only —
   * threads are one level deep.
   */
  replies?: CommentView[];
  /** Total live replies, so the UI can offer "show more". */
  replyCount?: number;
  /** Cursor to fetch the replies after `replies`; null when all are shown. */
  repliesCursor?: string | null;
}

/** A page of comments: top-level, newest first; or one thread's replies, oldest first. */
export interface CommentPage {
  items: CommentView[];
  nextCursor: string | null;
  /** Live comments on the problem, replies included. */
  commentCount: number;
}

/** Returned by every comment write, so the UI never computes a count itself. */
export interface CommentMutationResult {
  /** The created or updated comment; null after a removal leaves nothing to show. */
  comment: CommentView | null;
  commentCount: number;
}
