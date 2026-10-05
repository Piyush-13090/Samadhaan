import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  API_VERSION,
  type CommentMutationResult,
  type CommentPage,
  type FollowState,
  type ProblemEngagement,
  type SupportState,
} from '@samadhaan/shared';
import type { AuthenticatedRequest, RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { ProblemsService } from '../problems/problems.service.js';
import { CommentsService } from './comments.service.js';
import {
  CreateCommentDto,
  ListCommentsQueryDto,
  UpdateCommentDto,
} from './dto/comment.dto.js';
import { EngagementService } from './engagement.service.js';

/**
 * Support/follow toggles. Generous — a citizen working through a feed taps a
 * lot — but bounded, so a script cannot churn the counters.
 */
const ENGAGEMENT_LIMIT = {
  bucket: 'engagement',
  max: 60,
  windowSeconds: 60,
  message: 'You are doing that too often. Please wait a moment and try again.',
} as const;

/**
 * Comment writes. Ten a minute is far beyond a person typing considered
 * replies, and well short of a flood.
 */
const COMMENT_CREATE_LIMIT = {
  bucket: 'comment:create',
  max: 10,
  windowSeconds: 60,
  message: 'You are commenting very quickly. Please wait a minute before posting again.',
} as const;

const COMMENT_EDIT_LIMIT = {
  bucket: 'comment:edit',
  max: 30,
  windowSeconds: 60,
} as const;

/**
 * Community actions on a problem: support, follow and discussion.
 *
 * **Every route resolves the problem through `findAccessible`**, the same
 * visibility rule the problem page uses, so none of these can reach a draft its
 * caller could not open.
 *
 * **Identity only ever comes from the session.** No route takes a user id in
 * its path, query or body; the DTOs cannot express one, and the global
 * `forbidNonWhitelisted` turns an attempt into a 400. Counts are never accepted
 * from the client either — every response returns the server's own.
 *
 * Reads are public, like the problem itself. Writes require a session (the
 * global guard's default) and are rate limited per user.
 */
@Controller({ path: 'problems', version: API_VERSION.replace('v', '') })
export class CommunityController {
  constructor(
    private readonly problems: ProblemsService,
    private readonly engagement: EngagementService,
    private readonly comments: CommentsService,
  ) {}

  // ============================================================= engagement

  /** Counts and the viewer's own state, for the problem page header. */
  @Public()
  @Get(':publicId/engagement')
  async getEngagement(
    @Param('publicId') publicId: string,
    @Req() request: Request,
  ): Promise<ProblemEngagement> {
    const viewer = viewerOf(request);
    const problem = await this.problems.findAccessible(publicId, viewer);

    return this.engagement.summary(problem, viewer);
  }

  // ================================================================ support

  @Public()
  @Get(':publicId/support')
  async getSupport(
    @Param('publicId') publicId: string,
    @Req() request: Request,
  ): Promise<SupportState> {
    const viewer = viewerOf(request);
    const problem = await this.problems.findAccessible(publicId, viewer);

    return this.engagement.supportState(problem, viewer);
  }

  /** Idempotent: supporting twice leaves one support and returns the same state. */
  @Post(':publicId/support')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit(ENGAGEMENT_LIMIT)
  async support(
    @Param('publicId') publicId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<SupportState> {
    const problem = await this.problems.findAccessible(publicId, user);
    return this.engagement.support(problem, user);
  }

  @Delete(':publicId/support')
  @UserRateLimit(ENGAGEMENT_LIMIT)
  async unsupport(
    @Param('publicId') publicId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<SupportState> {
    const problem = await this.problems.findAccessible(publicId, user);
    return this.engagement.unsupport(problem, user);
  }

  // ================================================================= follow

  @Public()
  @Get(':publicId/follow')
  async getFollow(
    @Param('publicId') publicId: string,
    @Req() request: Request,
  ): Promise<FollowState> {
    const viewer = viewerOf(request);
    const problem = await this.problems.findAccessible(publicId, viewer);

    return this.engagement.followState(problem, viewer);
  }

  /** Idempotent, like support. */
  @Post(':publicId/follow')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit(ENGAGEMENT_LIMIT)
  async follow(
    @Param('publicId') publicId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<FollowState> {
    const problem = await this.problems.findAccessible(publicId, user);
    return this.engagement.follow(problem, user);
  }

  @Delete(':publicId/follow')
  @UserRateLimit(ENGAGEMENT_LIMIT)
  async unfollow(
    @Param('publicId') publicId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<FollowState> {
    const problem = await this.problems.findAccessible(publicId, user);
    return this.engagement.unfollow(problem, user);
  }

  // =============================================================== comments

  /**
   * Top-level comments, newest first, each with its first replies — or, with
   * `parentCommentId`, one thread's replies in reading order. Paginated; never
   * the whole discussion.
   */
  @Public()
  @Get(':publicId/comments')
  async listComments(
    @Param('publicId') publicId: string,
    @Query() query: ListCommentsQueryDto,
    @Req() request: Request,
  ): Promise<CommentPage> {
    const viewer = viewerOf(request);
    const problem = await this.problems.findAccessible(publicId, viewer);

    return this.comments.list(problem, viewer, query);
  }

  @Post(':publicId/comments')
  @HttpCode(HttpStatus.CREATED)
  @UserRateLimit(COMMENT_CREATE_LIMIT)
  async createComment(
    @Param('publicId') publicId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentMutationResult> {
    const problem = await this.problems.findAccessible(publicId, user);
    return this.comments.create(problem, user, dto);
  }

  @Patch(':publicId/comments/:commentId')
  @UserRateLimit(COMMENT_EDIT_LIMIT)
  async updateComment(
    @Param('publicId') publicId: string,
    @Param('commentId', new ParseUUIDPipe()) commentId: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentMutationResult> {
    const problem = await this.problems.findAccessible(publicId, user);
    return this.comments.update(problem, commentId, user, dto);
  }

  @Delete(':publicId/comments/:commentId')
  @UserRateLimit(COMMENT_EDIT_LIMIT)
  async deleteComment(
    @Param('publicId') publicId: string,
    @Param('commentId', new ParseUUIDPipe()) commentId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentMutationResult> {
    const problem = await this.problems.findAccessible(publicId, user);
    return this.comments.remove(problem, commentId, user);
  }
}

/** The optional principal a `@Public()` route may have. */
function viewerOf(request: Request): RequestUser | null {
  return (request as Request & AuthenticatedRequest).user ?? null;
}
