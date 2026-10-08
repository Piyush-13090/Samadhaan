import type { PriorityTier, ProblemCategory, ProblemStatus, ReputationTier } from '@samadhaan/shared';

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
  // ------------------------------------------------- resolution rooms (P17)
  | {
      /**
       * A participant posted in a resolution room. Carries no message text:
       * notifications say who wrote, never what.
       */
      type: 'RESOLUTION_MESSAGE_POSTED';
      roomId: string;
      messageId: string;
      problemPublicId: string;
      authorUserId: string;
      authorName: string;
      authorOrganizationName: string;
      /** Already intersected with the room's participants. */
      mentionedUserIds: string[];
    }
  // ------------------------------------------------------ projects (P18)
  | {
      /** Every project event names the room (for links) and the problem. */
      type: 'PROJECT_TASK_ASSIGNED';
      projectId: string;
      roomId: string;
      problemPublicId: string;
      taskId: string;
      taskTitle: string;
      assigneeId: string;
      /** The task version that made this assignment — stable for dedupe. */
      taskVersion: number;
      actorUserId: string;
    }
  | {
      type: 'PROJECT_TASK_DUE_SOON';
      projectId: string;
      roomId: string;
      problemPublicId: string;
      taskId: string;
      taskTitle: string;
      assigneeId: string;
      dueDate: string;
    }
  | {
      type: 'PROJECT_TASK_COMPLETED';
      projectId: string;
      roomId: string;
      problemPublicId: string;
      taskId: string;
      taskTitle: string;
      creatorId: string;
      actorUserId: string;
      actorName: string;
    }
  | {
      type: 'PROJECT_MILESTONE_COMPLETED';
      projectId: string;
      roomId: string;
      problemPublicId: string;
      milestoneId: string;
      milestoneTitle: string;
      /** ISO completion time — a reopened, re-completed milestone notifies again. */
      completedAt: string;
      actorUserId: string;
      actorOrganizationName: string;
    }
  | {
      type: 'PROJECT_STATUS_CHANGED';
      projectId: string;
      roomId: string;
      problemPublicId: string;
      from: string;
      to: string;
      actorUserId: string;
      actorOrganizationName: string;
      /** Distinguishes repeated transitions (paused twice) for dedupe. */
      changeId: string;
    }
  // ---------------------------------------------- AI coordinator (P19)
  | {
      /** Health worsened to AT_RISK/BLOCKED, or a new potential blocker. */
      type: 'COORDINATOR_ALERT';
      projectId: string;
      roomId: string;
      problemPublicId: string;
      insightId: string;
      headline: string;
      /** Who asked for the refresh; null for a scheduled check. */
      actorUserId: string | null;
    }
  | {
      type: 'COORDINATOR_QUESTIONS_ASKED';
      projectId: string;
      roomId: string;
      problemPublicId: string;
      insightId: string;
      count: number;
      /** Assignees of the tasks the questions are about. */
      assigneeIds: string[];
      actorUserId: string | null;
    }
  | {
      type: 'RESOLUTION_ROOM_CLOSED';
      roomId: string;
      problemPublicId: string;
      governmentName: string;
      actorUserId: string;
    }
  // -------------------------------------------------- priority engine (P21)
  | {
      /** The AI tier moved. Advisory: nothing acts on it automatically. */
      type: 'PRIORITY_TIER_CHANGED';
      problemId: string;
      problemPublicId: string;
      assessmentId: string;
      fromTier: PriorityTier | null;
      toTier: PriorityTier;
      score: number;
    }
  // ----------------------------------------- resolution verification (P22)
  | {
      type: 'EVIDENCE_SUBMITTED';
      evidenceId: string;
      evidenceTitle: string;
      projectId: string;
      roomId: string;
      problemPublicId: string;
      governmentOrganizationId: string;
      governmentSlug: string;
      organizationName: string;
      actorUserId: string;
    }
  | {
      type: 'EVIDENCE_REVIEWED';
      evidenceId: string;
      evidenceTitle: string;
      projectId: string;
      roomId: string;
      problemPublicId: string;
      governmentOrganizationId: string;
      governmentSlug: string;
      submittedById: string;
      assessmentId: string;
      /** Null when no AI review ran or it failed. Advisory either way. */
      recommendation: string | null;
    }
  | {
      type: 'VERIFICATION_REQUESTED';
      requestId: string;
      projectId: string;
      roomId: string;
      problemPublicId: string;
      governmentOrganizationId: string;
      governmentSlug: string;
      organizationId: string;
      organizationName: string;
      actorUserId: string;
    }
  | {
      type: 'VERIFICATION_DECIDED';
      requestId: string;
      decision: 'APPROVED' | 'REJECTED' | 'MORE_EVIDENCE_REQUESTED';
      projectId: string;
      roomId: string;
      problemPublicId: string;
      organizationId: string;
      governmentName: string;
      /** Shared with the organisation: the reason it must act on. */
      reason: string | null;
      submitterIds: string[];
      actorUserId: string;
    }
  // ----------------------------------------------------- impact points (P23)
  | {
      type: 'IMPACT_POINTS_AWARDED';
      userId: string;
      points: number;
      headline: string;
      problemPublicId: string | null;
      /** The source event, for notification de-duplication. */
      eventKey: string;
    }
  | { type: 'BADGE_EARNED'; userId: string; badgeKey: string; badgeName: string }
  | { type: 'REPUTATION_TIER_REACHED'; userId: string; tier: ReputationTier }
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
