import type {
  CommentMutationResult,
  CommentPage,
  FollowState,
  ProblemEngagement,
  SupportState,
} from '@samadhaan/shared';
import { api, createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Community actions on a problem: support, follow and discussion.
 *
 * Nothing here sends a user id or a count. Identity is the session cookie;
 * counts come back from the server on every response and the UI displays
 * those, never figures of its own.
 */

const path = (publicId: string, suffix: string) =>
  `/problems/${encodeURIComponent(publicId)}/${suffix}`;

// ------------------------------------------------------------- engagement

/** Header counts and the viewer's own state, resolved during server rendering. */
export async function fetchEngagementOnServer(
  publicId: string,
  cookieHeader: string,
): Promise<ProblemEngagement | null> {
  try {
    return await createServerApi().get<ProblemEngagement>(path(publicId, 'engagement'), {
      cache: 'no-store',
      headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
    });
  } catch (error) {
    // A section-level failure: the page still renders, without live controls.
    if (error instanceof ApiError) return null;
    throw error;
  }
}

export function supportProblem(publicId: string): Promise<SupportState> {
  return api.post<SupportState>(path(publicId, 'support'));
}

export function withdrawSupport(publicId: string): Promise<SupportState> {
  return api.delete<SupportState>(path(publicId, 'support'));
}

export function followProblem(publicId: string): Promise<FollowState> {
  return api.post<FollowState>(path(publicId, 'follow'));
}

export function unfollowProblem(publicId: string): Promise<FollowState> {
  return api.delete<FollowState>(path(publicId, 'follow'));
}

// --------------------------------------------------------------- comments

export interface CommentsQuery {
  cursor?: string;
  /** Lists one thread's replies instead of the top-level comments. */
  parentCommentId?: string;
  limit?: number;
}

export function fetchComments(
  publicId: string,
  query: CommentsQuery = {},
): Promise<CommentPage> {
  return api.get<CommentPage>(path(publicId, 'comments'), {
    query: { ...query },
    cache: 'no-store',
  });
}

/** The first page, during server rendering. Null on failure; the section retries. */
export async function fetchCommentsOnServer(
  publicId: string,
  cookieHeader: string,
): Promise<CommentPage | null> {
  try {
    return await createServerApi().get<CommentPage>(path(publicId, 'comments'), {
      cache: 'no-store',
      headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
    });
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

export function postComment(
  publicId: string,
  input: { body: string; parentCommentId?: string },
): Promise<CommentMutationResult> {
  return api.post<CommentMutationResult>(path(publicId, 'comments'), input);
}

export function editComment(
  publicId: string,
  commentId: string,
  body: string,
): Promise<CommentMutationResult> {
  return api.patch<CommentMutationResult>(
    path(publicId, `comments/${encodeURIComponent(commentId)}`),
    { body },
  );
}

export function deleteComment(
  publicId: string,
  commentId: string,
): Promise<CommentMutationResult> {
  return api.delete<CommentMutationResult>(
    path(publicId, `comments/${encodeURIComponent(commentId)}`),
  );
}
