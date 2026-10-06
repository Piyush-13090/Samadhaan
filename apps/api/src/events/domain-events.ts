import type { ProblemCategory, ProblemStatus } from '@samadhaan/shared';

/**
 * Domain events — facts about things that have already happened.
 *
 * Published by the module that did the work, **after** its transaction
 * commits, and consumed by anything that reacts: today the notification
 * system, later perhaps analytics or a realtime gateway. An event for a write
 * that rolled back would announce something that never happened, so nothing is
 * published from inside a transaction.
 *
 * Each event carries the ids a consumer needs to decide *who cares* — the
 * reporter, the parent comment's author — without re-querying the source, and
 * nothing private. Deciding who hears about what is the consumer's job.
 */
export type DomainEvent =
  // --------------------------------------------------------------- community
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
    }
  // ------------------------------------------------------------- AI pipeline
  | {
      /** One analysis job finished — after any internal retries, once. */
      type: 'AI_ANALYSIS_COMPLETED';
      problemId: string;
      problemPublicId: string;
      reporterId: string;
      analysisId: string;
      category: ProblemCategory | null;
    }
  | {
      type: 'AI_ANALYSIS_FAILED';
      problemId: string;
      problemPublicId: string;
      reporterId: string;
      analysisId: string;
    }
  | {
      /** A duplicate check finished with at least one likely match. */
      type: 'LIKELY_DUPLICATES_FOUND';
      problemId: string;
      problemPublicId: string;
      reporterId: string;
      /** Best first. Scores only — never vectors. */
      matches: Array<{
        candidateProblemId: string;
        candidatePublicId: string;
        /** 0–1 combined score. */
        similarity: number;
      }>;
    }
  // ----------------------------------------------------------- organisations
  | {
      /**
       * An organisation changed in a way that can change who it matches:
       * its profile wording, its expertise, its location or its standing.
       * Consumed by organisation matching to refresh embeddings and matches.
       */
      type: 'ORGANIZATION_PROFILE_CHANGED';
      organizationId: string;
      changes: Array<'profile' | 'expertise' | 'location' | 'status'>;
    }
  // -------------------------------------------------------------- allocation
  | {
      /**
       * Prompt 16. One event shape for the four allocation moments; `type`
       * says which. Names and slugs are public facts, carried so notifications
       * can be worded and linked without another query.
       */
      type:
        | 'ALLOCATION_CREATED'
        | 'ALLOCATION_ACCEPTED'
        | 'ALLOCATION_DECLINED'
        | 'ALLOCATION_CANCELLED';
      allocationId: string;
      problemId: string;
      problemPublicId: string;
      organizationId: string;
      organizationSlug: string;
      organizationName: string;
      governmentOrganizationId: string;
      governmentSlug: string;
      governmentName: string;
      actorUserId: string;
    }
  // --------------------------------------------------------------- lifecycle
  | {
      /**
       * A problem's status actually changed. Emitted only when `from !== to`,
       * by whatever performed the change — today, confirming a duplicate;
       * later, government review and resolution.
       */
      type: 'PROBLEM_STATUS_CHANGED';
      problemId: string;
      problemPublicId: string;
      reporterId: string;
      fromStatus: ProblemStatus;
      toStatus: ProblemStatus;
      /** Null for a system-initiated change. */
      actorUserId: string | null;
      /**
       * Unique per change, so notifications about it are idempotent: the same
       * problem can move to the same status twice and both are real events.
       */
      changeId: string;
      /** The government office that reviewed it, when one did (Prompt 15). */
      reviewedBy?: string;
    };

export type DomainEventType = DomainEvent['type'];
