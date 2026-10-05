import { Injectable, Logger } from '@nestjs/common';

/**
 * Community events — the seam Prompt 11's notifications attach to.
 *
 * Each event carries the ids a notification needs to decide *who* to tell
 * (the reporter, the parent comment's author) without re-querying, and nothing
 * that would let a consumer leak more than the event's subject. Recipients are
 * deliberately not resolved here: deciding who hears about what — and honouring
 * their preferences — is the notification system's job, not the action's.
 *
 * Published only **after** the write commits. An event for a support that
 * rolled back would notify someone of something that never happened.
 */
export type CommunityEvent =
  | {
      type: 'PROBLEM_SUPPORTED';
      problemId: string;
      problemPublicId: string;
      reporterId: string;
      actorUserId: string;
    }
  | {
      type: 'PROBLEM_FOLLOWED';
      problemId: string;
      problemPublicId: string;
      actorUserId: string;
    }
  | {
      type: 'COMMENT_CREATED';
      problemId: string;
      problemPublicId: string;
      reporterId: string;
      commentId: string;
      actorUserId: string;
    }
  | {
      type: 'COMMENT_REPLIED';
      problemId: string;
      problemPublicId: string;
      reporterId: string;
      commentId: string;
      parentCommentId: string;
      /** The author being replied to. */
      parentAuthorId: string;
      actorUserId: string;
    }
  | {
      type: 'COMMENT_REMOVED';
      problemId: string;
      commentId: string;
      actorUserId: string;
      /** True when a moderator removed someone else's comment. */
      byModerator: boolean;
    };

/**
 * Publishes community events.
 *
 * Today the only consumer is the log, at debug level. Prompt 11 replaces the
 * body of `publish` — a queue, an outbox table — and nothing that calls it
 * changes. Kept synchronous and non-throwing on purpose: a notification
 * failure must never fail the civic action that caused it.
 */
@Injectable()
export class CommunityEventPublisher {
  private readonly logger = new Logger(CommunityEventPublisher.name);

  publish(event: CommunityEvent): void {
    try {
      this.logger.debug(`${event.type} on ${event.problemId} by ${event.actorUserId}`);
    } catch {
      // Logging cannot meaningfully fail, but the contract is "never throws",
      // and that contract is what a real transport will have to honour.
    }
  }
}
