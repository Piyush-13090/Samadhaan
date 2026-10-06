import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  REPLY_PREVIEW_COUNT,
  type CommentMutationResult,
  type CommentPage,
  type CommentView,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { decodeIdCursor, encodeIdCursor } from '../common/id-cursor.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AccessibleProblem } from '../problems/problems.service.js';
import { checkCommentContent, normalizeCommentBody } from './comment-content.js';
import {
  COMMENT_AUTHOR_SELECT,
  toCommentView,
  type CommentRow,
  type CommentViewContext,
} from './comment.serializer.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import type {
  CreateCommentDto,
  ListCommentsQueryDto,
  UpdateCommentDto,
} from './dto/comment.dto.js';
import { assertAcceptsEngagement, moveCounter } from './engagement.service.js';

/**
 * Problem discussion.
 *
 * **Threads are one level deep.** A comment may have replies; a reply may not.
 * Deeper nesting turns a civic discussion into an argument tree that no one
 * can follow on a phone, and the schema's adjacency list is kept honest by
 * refusing it here rather than flattening silently.
 *
 * **Bounded reads, no N+1.** A page is four queries however many comments it
 * holds: the top-level page, the ids of each one's first replies (a window
 * function, so one prolific thread cannot load hundreds of rows), those replies
 * with their authors, and the per-thread reply counts.
 *
 * **Ownership is checked here, on every write.** The path names a comment; the
 * session names a user; the two are compared against the stored row. Nothing
 * in the request body can influence who wrote a comment.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
  ) {}

  // =================================================================== read

  async list(
    problem: AccessibleProblem,
    viewer: RequestUser | null,
    query: ListCommentsQueryDto,
  ): Promise<CommentPage> {
    const context = this.contextFor(problem, viewer);

    return query.parentCommentId
      ? this.listReplies(problem, query.parentCommentId, query, context)
      : this.listTopLevel(problem, query, context);
  }

  private async listTopLevel(
    problem: AccessibleProblem,
    query: ListCommentsQueryDto,
    context: CommentViewContext,
  ): Promise<CommentPage> {
    const [rows, commentCount] = await Promise.all([
      this.prisma.problemComment.findMany({
        where: {
          problemId: problem.id,
          parentCommentId: null,
          // A removed comment stays only while it still holds live replies.
          // With none, there is nothing for its placeholder to anchor.
          OR: [{ deletedAt: null }, { replies: { some: { deletedAt: null } } }],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor
          ? { cursor: { id: decodeIdCursor(query.cursor) }, skip: 1 }
          : {}),
        include: { user: { select: COMMENT_AUTHOR_SELECT } },
      }),
      this.commentCount(problem.id),
    ]);

    const page = rows.slice(0, query.limit);
    const nextCursor =
      rows.length > query.limit && page.at(-1) ? encodeIdCursor(page.at(-1)!.id) : null;

    const threads = await this.attachReplies(page, context);

    return { items: threads, nextCursor, commentCount };
  }

  /**
   * The first few replies of each comment on a page, and how many there are.
   *
   * `ROW_NUMBER()` caps each thread's preview in the database — a plain
   * `parentCommentId IN (…)` would load every reply to every comment on the
   * page, which is unbounded the first time a thread gets busy.
   */
  private async attachReplies(
    parents: CommentRow[],
    context: CommentViewContext,
  ): Promise<CommentView[]> {
    if (parents.length === 0) return [];

    const parentIds = parents.map((parent) => parent.id);

    const [previewIds, counts] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT ranked.id
        FROM (
          SELECT c.id,
                 ROW_NUMBER() OVER (
                   PARTITION BY c."parentCommentId"
                   ORDER BY c."createdAt" ASC, c.id ASC
                 ) AS position
          FROM problem_comments c
          WHERE c."parentCommentId" = ANY (${parentIds}::uuid[])
            AND c."deletedAt" IS NULL
        ) ranked
        WHERE ranked.position <= ${REPLY_PREVIEW_COUNT}
      `,
      this.prisma.problemComment.groupBy({
        by: ['parentCommentId'],
        where: { parentCommentId: { in: parentIds }, deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    const replies =
      previewIds.length > 0
        ? await this.prisma.problemComment.findMany({
            where: { id: { in: previewIds.map((row) => row.id) } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: { user: { select: COMMENT_AUTHOR_SELECT } },
          })
        : [];

    const countByParent = new Map(
      counts.map((row) => [row.parentCommentId, row._count._all]),
    );

    return parents.map((parent) => {
      const preview = replies.filter((reply) => reply.parentCommentId === parent.id);
      const replyCount = countByParent.get(parent.id) ?? 0;
      const last = preview.at(-1);

      return {
        ...toCommentView(parent, context),
        replies: preview.map((reply) => toCommentView(reply, context)),
        replyCount,
        repliesCursor:
          replyCount > preview.length && last ? encodeIdCursor(last.id) : null,
      };
    });
  }

  private async listReplies(
    problem: AccessibleProblem,
    parentCommentId: string,
    query: ListCommentsQueryDto,
    context: CommentViewContext,
  ): Promise<CommentPage> {
    // The parent must belong to *this* problem. Otherwise any problem's URL
    // would read any thread, and the problem's own visibility check — a draft
    // is private — would protect nothing.
    const parent = await this.prisma.problemComment.findFirst({
      where: { id: parentCommentId, problemId: problem.id, parentCommentId: null },
      select: { id: true },
    });
    if (!parent) throw AppException.notFound('Comment');

    const [rows, commentCount] = await Promise.all([
      this.prisma.problemComment.findMany({
        where: { parentCommentId, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor
          ? { cursor: { id: decodeIdCursor(query.cursor) }, skip: 1 }
          : {}),
        include: { user: { select: COMMENT_AUTHOR_SELECT } },
      }),
      this.commentCount(problem.id),
    ]);

    const page = rows.slice(0, query.limit);
    const nextCursor =
      rows.length > query.limit && page.at(-1) ? encodeIdCursor(page.at(-1)!.id) : null;

    return {
      items: page.map((row) => toCommentView(row, context)),
      nextCursor,
      commentCount,
    };
  }

  // ================================================================== write

  async create(
    problem: AccessibleProblem,
    user: RequestUser,
    dto: CreateCommentDto,
  ): Promise<CommentMutationResult> {
    assertAcceptsEngagement(problem);

    const body = this.validatedBody(dto.body);
    const parent = dto.parentCommentId
      ? await this.replyableParent(problem, dto.parentCommentId)
      : null;

    const { comment, commentCount } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.problemComment.create({
        data: {
          problemId: problem.id,
          // From the verified session. The DTO cannot carry a user id, and the
          // global whitelist rejects a request that tries.
          userId: user.id,
          parentCommentId: parent?.id ?? null,
          body,
        },
        include: { user: { select: COMMENT_AUTHOR_SELECT } },
      });

      // Counter and recency in one statement, under the row lock, without
      // touching the problem's `updatedAt` — a comment is not an edit to the
      // report.
      const [row] = await tx.$queryRaw<Array<{ commentCount: number }>>`
        UPDATE problems
        SET "commentCount" = "commentCount" + 1,
            "lastCommentAt" = ${created.createdAt}
        WHERE id = ${problem.id}::uuid
        RETURNING "commentCount"
      `;

      return { comment: created, commentCount: row?.commentCount ?? 0 };
    });

    this.publishCreated(problem, comment.id, user, parent);

    const context = this.contextFor(problem, user);
    const view = toCommentView(comment, context);

    return {
      // A new top-level comment starts its own (empty) thread.
      comment: parent
        ? view
        : { ...view, replies: [], replyCount: 0, repliesCursor: null },
      commentCount,
    };
  }

  async update(
    problem: AccessibleProblem,
    commentId: string,
    user: RequestUser,
    dto: UpdateCommentDto,
  ): Promise<CommentMutationResult> {
    const existing = await this.findOnProblem(problem, commentId);

    // A removed comment is gone as far as anyone outside moderation is
    // concerned, so editing one is a 404 rather than a way to revive it.
    if (existing.deletedAt) throw AppException.notFound('Comment');

    // Only the author. Not an admin either: a moderator may remove words, but
    // putting different words in someone's mouth is never moderation.
    if (existing.userId !== user.id) {
      throw AppException.forbidden('You can only edit your own comments.');
    }

    const body = this.validatedBody(dto.body);

    // Saving unchanged text is not an edit and must not earn the "edited" mark.
    const updated =
      body === existing.body
        ? existing
        : await this.prisma.problemComment.update({
            where: { id: existing.id },
            data: { body, isEdited: true },
            include: { user: { select: COMMENT_AUTHOR_SELECT } },
          });

    return {
      comment: toCommentView(updated, this.contextFor(problem, user)),
      commentCount: await this.commentCount(problem.id),
    };
  }

  /**
   * Removes a comment — softly, so its replies keep their place in the thread.
   *
   * The author may remove their own; a platform admin may remove anyone's, and
   * that is audited, because a moderator silently deleting speech is exactly
   * the action that most needs a record. Idempotent: removing an already
   * removed comment succeeds and changes nothing.
   */
  async remove(
    problem: AccessibleProblem,
    commentId: string,
    user: RequestUser,
  ): Promise<CommentMutationResult> {
    const existing = await this.findOnProblem(problem, commentId);

    const own = existing.userId === user.id;
    const moderator = user.role === 'ADMIN';

    if (!own && !moderator) {
      throw AppException.forbidden('You can only delete your own comments.');
    }

    if (existing.deletedAt) {
      return { comment: null, commentCount: await this.commentCount(problem.id) };
    }

    const commentCount = await this.prisma.$transaction(async (tx) => {
      // Conditional on still being live, so two concurrent deletes move the
      // counter once between them.
      const { count } = await tx.problemComment.updateMany({
        where: { id: existing.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      if (count > 0 && !own) {
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'COMMENT_REMOVED_BY_MODERATOR',
            entityType: 'ProblemComment',
            entityId: existing.id,
            metadata: { problemPublicId: problem.publicId, authorId: existing.userId },
          },
        });
      }

      return moveCounter(tx, problem.id, 'commentCount', -count);
    });

    this.events.publish({
      type: 'COMMENT_REMOVED',
      problemId: problem.id,
      commentId: existing.id,
      actorUserId: user.id,
      byModerator: !own,
    });

    return { comment: null, commentCount };
  }

  // ================================================================ helpers

  /** Normalises, then applies the content policy. Never trusts the client's own checks. */
  private validatedBody(raw: string): string {
    const body = normalizeCommentBody(raw);
    const decision = checkCommentContent(body);

    if (!decision.allowed) {
      throw new AppException(
        ERROR_CODES.VALIDATION_FAILED,
        decision.reason,
        HttpStatus.BAD_REQUEST,
        [{ field: 'body', message: decision.reason }],
      );
    }

    return body;
  }

  /**
   * The comment being replied to, if it may be.
   *
   * One message for "does not exist", "belongs to another problem" and "was
   * removed": distinguishing them would let a caller probe which comment ids
   * exist on which problems.
   */
  private async replyableParent(problem: AccessibleProblem, parentCommentId: string) {
    const parent = await this.prisma.problemComment.findFirst({
      where: { id: parentCommentId, problemId: problem.id, deletedAt: null },
      select: { id: true, userId: true, parentCommentId: true },
    });

    if (!parent) {
      throw this.parentError('The comment you are replying to is no longer available.');
    }

    if (parent.parentCommentId !== null) {
      throw this.parentError(
        'Replies can only be one level deep. Reply to the original comment instead.',
      );
    }

    return parent;
  }

  private parentError(message: string): AppException {
    return new AppException(
      ERROR_CODES.VALIDATION_FAILED,
      message,
      HttpStatus.BAD_REQUEST,
      [{ field: 'parentCommentId', message }],
    );
  }

  /**
   * A comment, scoped to the problem in the path.
   *
   * The scope is the IDOR defence: `/problems/A/comments/<id of a comment on B>`
   * is a 404, so a valid comment id cannot be used through some other problem's
   * route — including one the caller can see but the comment's problem they
   * cannot.
   */
  private async findOnProblem(problem: AccessibleProblem, commentId: string) {
    const comment = await this.prisma.problemComment.findFirst({
      where: { id: commentId, problemId: problem.id },
      include: { user: { select: COMMENT_AUTHOR_SELECT } },
    });

    if (!comment) throw AppException.notFound('Comment');
    return comment;
  }

  private async commentCount(problemId: string): Promise<number> {
    const row = await this.prisma.problem.findUniqueOrThrow({
      where: { id: problemId },
      select: { commentCount: true },
    });
    return row.commentCount;
  }

  private contextFor(
    problem: AccessibleProblem,
    viewer: RequestUser | null,
  ): CommentViewContext {
    return {
      viewerId: viewer?.id ?? null,
      viewerIsAdmin: viewer?.role === 'ADMIN',
      reporterId: problem.reporterId,
    };
  }

  private publishCreated(
    problem: AccessibleProblem,
    commentId: string,
    user: RequestUser,
    parent: { id: string; userId: string } | null,
  ): void {
    if (parent) {
      this.events.publish({
        type: 'COMMENT_REPLIED',
        problemId: problem.id,
        problemPublicId: problem.publicId,
        reporterId: problem.reporterId,
        commentId,
        parentCommentId: parent.id,
        parentAuthorId: parent.userId,
        actorUserId: user.id,
      });
      return;
    }

    this.events.publish({
      type: 'COMMENT_CREATED',
      problemId: problem.id,
      problemPublicId: problem.publicId,
      reporterId: problem.reporterId,
      commentId,
      actorUserId: user.id,
    });
  }
}
