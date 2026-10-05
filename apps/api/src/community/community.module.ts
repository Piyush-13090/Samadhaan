import { Module } from '@nestjs/common';
import { ProblemsModule } from '../problems/problems.module.js';
import { CommentsService } from './comments.service.js';
import { CommunityEventPublisher } from './community-events.js';
import { CommunityController } from './community.controller.js';
import { EngagementService } from './engagement.service.js';

/**
 * Community engagement on problems: support, follow and threaded discussion.
 *
 * Its own module rather than more routes on `ProblemsModule`. A problem is the
 * civic record; community activity is what people do *around* it, and has its
 * own rate limits, its own moderation future and — from Prompt 11 — its own
 * notification consumers. `ProblemsModule` stays ignorant of all of it; this
 * module depends on it for exactly one thing, resolving a problem the caller
 * may see.
 *
 * `CommunityEventPublisher` is exported so the notification module can take it
 * over without reaching into this one.
 */
@Module({
  imports: [ProblemsModule],
  controllers: [CommunityController],
  providers: [EngagementService, CommentsService, CommunityEventPublisher],
  exports: [CommunityEventPublisher],
})
export class CommunityModule {}
