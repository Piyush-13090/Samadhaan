import type {
  NotificationEntityType,
  NotificationType,
  ProblemCategory,
  ProblemStatus,
} from '@samadhaan/shared';
import type { DomainEvent } from '../events/domain-events.js';
import type { NotificationMetadata } from './notification-metadata.js';

/** One notification to write. Rendered here, once, and stored as text. */
export interface NotificationDraft {
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  entityId: string | null;
  metadata: NotificationMetadata;
  /**
   * Identifies the *event*, not the row. Unique per recipient in the database,
   * so a replayed or retried event inserts nothing the second time.
   */
  dedupeKey: string;
}

/**
 * Facts the planner needs that are not on the event itself, resolved by the
 * handler with a query or two. Kept out of the event so publishers do not have
 * to know what notifications will say.
 */
export interface PlanningFacts {
  /** Public name of the acting user, for comment and reply wording. */
  actorName?: string;
  /** Everyone following the problem, for status changes. */
  followerIds?: string[];
  /** Allocation recipients: the organisation's owners and admins, or the
   *  allocating office's officials — whichever the event is for. */
  allocationRecipientIds?: string[];
  /**
   * Resolution rooms: every current participant, and each one's read marker
   * (ISO time, or null if they never read the room).
   */
  roomParticipants?: Array<{ userId: string; lastReadAt: string | null }>;
  /**
   * The people who coordinate a project: the assigned organisation's
   * OWNER/ADMIN and the allocating office's officials — plus, for questions,
   * the active assignees the questions are about.
   */
  coordinatorRecipientIds?: string[];
}

/**
 * Turns a domain event into the notifications it should produce.
 *
 * **All recipient rules live here**, in one pure function, so "who hears about
 * what" can be read in one place and tested without a database:
 *
 * | Event | Recipient |
 * | --- | --- |
 * | AI analysis completed / failed | the reporter |
 * | Likely duplicate found | the reporter |
 * | Problem supported | the reporter, once per supporter |
 * | Comment on a problem | the reporter |
 * | Reply to a comment | the parent comment's author; and the reporter, if different |
 * | Status changed | the reporter; and every follower who is not the reporter |
 *
 * And one rule over all of them: **nobody is notified about their own
 * action.** Supporting your own report, replying under your own comment, or
 * confirming your own report as a duplicate notifies no one about you to you.
 *
 * Wording names only what the recipient may already see: a public reference, a
 * category, a status, and a commenter's public display name (comments are
 * public). Supporters are **not** named — who supports what is never shown
 * anywhere else in the product, and a notification must not be the leak.
 */
export function planNotifications(
  event: DomainEvent,
  facts: PlanningFacts = {},
): NotificationDraft[] {
  switch (event.type) {
    case 'AI_ANALYSIS_COMPLETED': {
      const category = event.category
        ? ` as a ${categoryLabel(event.category)} issue`
        : '';
      return [
        {
          recipientId: event.reporterId,
          type: 'AI_ANALYSIS_COMPLETED',
          title: 'AI analysis completed',
          message: `Samadhaan analysed your report ${event.problemPublicId} and identified it${category}.`,
          entityType: 'PROBLEM',
          entityId: event.problemId,
          metadata: { problemPublicId: event.problemPublicId },
          dedupeKey: `analysis:${event.analysisId}`,
        },
      ];
    }

    case 'AI_ANALYSIS_FAILED':
      return [
        {
          recipientId: event.reporterId,
          type: 'AI_ANALYSIS_FAILED',
          title: "AI analysis couldn't be completed",
          message: `We couldn't analyse ${event.problemPublicId}. You can try again from your problem.`,
          entityType: 'PROBLEM',
          entityId: event.problemId,
          metadata: { problemPublicId: event.problemPublicId },
          dedupeKey: `analysis:${event.analysisId}`,
        },
      ];

    case 'LIKELY_DUPLICATES_FOUND': {
      const [best] = event.matches;
      if (!best) return [];

      const others = event.matches.length - 1;
      const percent = Math.round(best.similarity * 100);

      return [
        {
          recipientId: event.reporterId,
          type: 'POSSIBLE_DUPLICATE_FOUND',
          title: 'Possible duplicate found',
          message:
            `Samadhaan found a similar report: ${best.candidatePublicId} (${percent}% match)` +
            (others > 0 ? ` and ${others} more.` : '.') +
            ' Review it on your problem.',
          entityType: 'DUPLICATE',
          entityId: event.problemId,
          metadata: {
            problemPublicId: event.problemPublicId,
            candidatePublicId: best.candidatePublicId,
            similarity: best.similarity,
          },
          // Keyed on the pair: re-running the check and finding the same match
          // is not news. A *different* best match is.
          dedupeKey: `duplicate:${event.problemId}:${best.candidateProblemId}`,
        },
      ];
    }

    case 'PROBLEM_SUPPORTED':
      if (event.actorUserId === event.reporterId) return [];
      return [
        {
          recipientId: event.reporterId,
          type: 'PROBLEM_SUPPORTED',
          title: 'Someone supported your problem',
          message: `Another citizen supported ${event.problemPublicId}, adding weight to it.`,
          entityType: 'PROBLEM',
          entityId: event.problemId,
          metadata: { problemPublicId: event.problemPublicId },
          // Once per supporter, ever. Withdrawing and re-adding support — or
          // tapping repeatedly — cannot turn into a stream of notifications.
          dedupeKey: `support:${event.problemId}:${event.actorUserId}`,
        },
      ];

    case 'COMMENT_CREATED':
      if (event.actorUserId === event.reporterId) return [];
      return [
        {
          recipientId: event.reporterId,
          type: 'PROBLEM_COMMENTED',
          title: 'New comment on your problem',
          message: `${facts.actorName ?? 'Someone'} commented on ${event.problemPublicId}.`,
          entityType: 'COMMENT',
          entityId: event.commentId,
          metadata: {
            problemPublicId: event.problemPublicId,
            commentId: event.commentId,
          },
          dedupeKey: `comment:${event.commentId}`,
        },
      ];

    case 'COMMENT_REPLIED': {
      const actor = facts.actorName ?? 'Someone';
      const drafts: NotificationDraft[] = [];

      if (event.parentAuthorId !== event.actorUserId) {
        drafts.push({
          recipientId: event.parentAuthorId,
          type: 'COMMENT_REPLIED',
          title: 'New reply to your comment',
          message: `${actor} replied to your comment on ${event.problemPublicId}.`,
          entityType: 'COMMENT',
          entityId: event.commentId,
          metadata: {
            problemPublicId: event.problemPublicId,
            commentId: event.commentId,
          },
          dedupeKey: `comment:${event.commentId}`,
        });
      }

      // The reporter hears about discussion on their problem too — but once:
      // if they wrote the parent, the reply notification already told them.
      if (
        event.reporterId !== event.actorUserId &&
        event.reporterId !== event.parentAuthorId
      ) {
        drafts.push({
          recipientId: event.reporterId,
          type: 'PROBLEM_COMMENTED',
          title: 'New comment on your problem',
          message: `${actor} replied in the discussion on ${event.problemPublicId}.`,
          entityType: 'COMMENT',
          entityId: event.commentId,
          metadata: {
            problemPublicId: event.problemPublicId,
            commentId: event.commentId,
          },
          dedupeKey: `comment:${event.commentId}`,
        });
      }

      return drafts;
    }

    case 'PROBLEM_STATUS_CHANGED': {
      if (event.fromStatus === event.toStatus) return [];

      const status = statusLabel(event.toStatus);
      const metadata: NotificationMetadata = {
        problemPublicId: event.problemPublicId,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
      };
      const dedupeKey = `status:${event.changeId}`;
      const drafts: NotificationDraft[] = [];

      if (event.reporterId !== event.actorUserId) {
        drafts.push({
          recipientId: event.reporterId,
          type: 'PROBLEM_STATUS_CHANGED',
          title: reporterTitle(event.toStatus),
          message: reporterMessage(
            event.problemPublicId,
            event.toStatus,
            event.reviewedBy,
            status,
          ),
          entityType: 'PROBLEM',
          entityId: event.problemId,
          metadata,
          dedupeKey,
        });
      }

      // Followers, excluding the reporter (told above, in their own words) and
      // whoever made the change.
      const followers = new Set(facts.followerIds ?? []);
      followers.delete(event.reporterId);
      if (event.actorUserId) followers.delete(event.actorUserId);

      for (const followerId of followers) {
        drafts.push({
          recipientId: followerId,
          type: 'FOLLOWED_PROBLEM_UPDATED',
          title: `You're following ${event.problemPublicId}`,
          message: `${event.problemPublicId} is now ${status}.`,
          entityType: 'PROBLEM',
          entityId: event.problemId,
          metadata,
          dedupeKey,
        });
      }

      return drafts;
    }

    // Following and comment removal are recorded facts, not news for anyone.
    // An organisation editing its profile is not either — and matching never
    // notifies: a match is a recommendation, not an assignment.
    case 'PROBLEM_FOLLOWED':
    case 'COMMENT_REMOVED':
    case 'ORGANIZATION_PROFILE_CHANGED':
      return [];

    // Allocation (Prompt 16). Recipients come from the handler: the
    // organisation's OWNER/ADMIN for a request or a withdrawal, the office's
    // officials for a response. Never the person who acted.
    // Room messages are deliberately quiet. A participant gets **one** "new
    // messages" notification per unread streak — the dedupe key carries their
    // read marker, so until they open the room again, further messages add
    // nothing. Being mentioned always notifies, once per message. Never the
    // author; never anyone who is not a current participant.
    case 'RESOLUTION_MESSAGE_POSTED': {
      const participants = facts.roomParticipants ?? [];
      const participantIds = new Set(participants.map((p) => p.userId));
      const mentioned = new Set(
        event.mentionedUserIds.filter(
          (id) => participantIds.has(id) && id !== event.authorUserId,
        ),
      );
      const metadata = { problemPublicId: event.problemPublicId, roomId: event.roomId };
      const drafts: NotificationDraft[] = [...mentioned].map((recipientId) => ({
        recipientId,
        type: 'RESOLUTION_MENTION',
        title: `You were mentioned in ${event.problemPublicId}`,
        message: `${event.authorName} (${event.authorOrganizationName}) mentioned you in the resolution room.`,
        entityType: 'RESOLUTION_ROOM',
        entityId: event.roomId,
        metadata,
        dedupeKey: `resolution_mention:${event.messageId}`,
      }));
      for (const participant of participants) {
        if (
          participant.userId === event.authorUserId ||
          mentioned.has(participant.userId)
        ) {
          continue;
        }
        drafts.push({
          recipientId: participant.userId,
          type: 'RESOLUTION_MESSAGE',
          title: `New messages in ${event.problemPublicId}`,
          message: `${event.authorName} (${event.authorOrganizationName}) wrote in the resolution room.`,
          entityType: 'RESOLUTION_ROOM',
          entityId: event.roomId,
          metadata,
          dedupeKey: `resolution_message:${event.roomId}:${participant.lastReadAt ?? 'never'}`,
        });
      }
      return drafts;
    }

    // Projects: a task goes to one person — its assignee, or its creator when
    // someone else completes it. Milestones and project status go to every
    // participant but the actor. Due-soon fires once per task per due date.
    case 'PROJECT_TASK_ASSIGNED':
      return event.assigneeId === event.actorUserId
        ? []
        : [
            projectDraft(event, event.assigneeId, {
              type: 'PROJECT_TASK_ASSIGNED',
              title: 'New task assigned',
              message: `You were assigned "${event.taskTitle}" in project ${event.problemPublicId}.`,
              dedupeKey: `project_task_assigned:${event.taskId}:v${event.taskVersion}`,
            }),
          ];

    case 'PROJECT_TASK_DUE_SOON':
      return [
        projectDraft(event, event.assigneeId, {
          type: 'PROJECT_TASK_DUE_SOON',
          title: 'Task due soon',
          message: `"${event.taskTitle}" in project ${event.problemPublicId} is due on ${event.dueDate}.`,
          dedupeKey: `project_task_due:${event.taskId}:${event.dueDate}`,
        }),
      ];

    case 'PROJECT_TASK_COMPLETED':
      return event.creatorId === event.actorUserId
        ? []
        : [
            projectDraft(event, event.creatorId, {
              type: 'PROJECT_TASK_COMPLETED',
              title: 'Task completed',
              message: `${event.actorName} completed "${event.taskTitle}" in project ${event.problemPublicId}.`,
              dedupeKey: `project_task_completed:${event.taskId}`,
            }),
          ];

    case 'PROJECT_MILESTONE_COMPLETED':
      return (facts.roomParticipants ?? [])
        .filter((participant) => participant.userId !== event.actorUserId)
        .map((participant) =>
          projectDraft(event, participant.userId, {
            type: 'PROJECT_MILESTONE_COMPLETED',
            title: 'Milestone completed',
            message: `${event.actorOrganizationName} completed "${event.milestoneTitle}" in project ${event.problemPublicId}.`,
            dedupeKey: `project_milestone_completed:${event.milestoneId}:${event.completedAt}`,
          }),
        );

    case 'PROJECT_STATUS_CHANGED':
      return (facts.roomParticipants ?? [])
        .filter((participant) => participant.userId !== event.actorUserId)
        .map((participant) =>
          projectDraft(event, participant.userId, {
            type: 'PROJECT_STATUS_CHANGED',
            title: `Project ${PROJECT_STATUS_WORD[event.to] ?? 'updated'}`,
            message: `${event.actorOrganizationName} marked the project for ${event.problemPublicId} as ${PROJECT_STATUS_WORD[event.to] ?? event.to.toLowerCase()}.`,
            dedupeKey: `project_status:${event.changeId}`,
          }),
        );

    // The coordinator is quiet by design: only a worsening health or a new
    // potential blocker alerts, and new questions notify once per analysis.
    // Never the person who asked for the refresh; never on every refresh.
    case 'COORDINATOR_ALERT':
      return (facts.coordinatorRecipientIds ?? [])
        .filter((id) => id !== event.actorUserId)
        .map((recipientId) =>
          projectDraft(event, recipientId, {
            type: 'PROJECT_COORDINATOR_ALERT',
            title: `Project ${event.problemPublicId} needs attention`,
            message: event.headline,
            dedupeKey: `coordinator_alert:${event.insightId}`,
          }),
        );

    case 'COORDINATOR_QUESTIONS_ASKED':
      return (facts.coordinatorRecipientIds ?? [])
        .filter((id) => id !== event.actorUserId)
        .map((recipientId) =>
          projectDraft(event, recipientId, {
            type: 'PROJECT_COORDINATOR_QUESTION',
            title: 'The project coordinator has questions',
            message: `${event.count === 1 ? 'A question needs' : `${event.count} questions need`} a response in project ${event.problemPublicId}.`,
            dedupeKey: `coordinator_questions:${event.insightId}`,
          }),
        );

    case 'RESOLUTION_ROOM_CLOSED':
      return (facts.roomParticipants ?? [])
        .filter((participant) => participant.userId !== event.actorUserId)
        .map((participant) => ({
          recipientId: participant.userId,
          type: 'RESOLUTION_ROOM_CLOSED',
          title: 'Resolution room closed',
          message: `${event.governmentName} closed the resolution room for ${event.problemPublicId}.`,
          entityType: 'RESOLUTION_ROOM',
          entityId: event.roomId,
          metadata: { problemPublicId: event.problemPublicId, roomId: event.roomId },
          dedupeKey: `resolution_room_closed:${event.roomId}`,
        }));

    case 'ALLOCATION_CREATED':
    case 'ALLOCATION_ACCEPTED':
    case 'ALLOCATION_DECLINED':
    case 'ALLOCATION_CANCELLED': {
      const wording = ALLOCATION_WORDING[event.type](event);
      const recipients = new Set(facts.allocationRecipientIds ?? []);
      recipients.delete(event.actorUserId);
      return [...recipients].map((recipientId) => ({
        recipientId,
        type: wording.type,
        title: wording.title,
        message: wording.message,
        entityType: 'ALLOCATION',
        entityId: event.allocationId,
        metadata: {
          problemPublicId: event.problemPublicId,
          allocationId: event.allocationId,
          organizationSlug: event.organizationSlug,
          governmentSlug: event.governmentSlug,
        },
        dedupeKey: `${event.type.toLowerCase()}:${event.allocationId}`,
      }));
    }
  }
}

/**
 * What a reporter is told when a government office reviews their report.
 * Plain and specific; never the reviewer's internal note.
 */
function reporterTitle(to: ProblemStatus): string {
  if (to === 'VERIFIED') return 'Your problem was verified';
  if (to === 'REJECTED') return 'Your report was not accepted';
  if (to === 'UNDER_REVIEW') return 'Your problem is being reviewed';
  return 'Your problem was updated';
}

function reporterMessage(
  publicId: string,
  to: ProblemStatus,
  reviewedBy: string | undefined,
  label: string,
): string {
  const by = reviewedBy ? ` by ${reviewedBy}` : '';
  if (to === 'VERIFIED') return `${publicId} has been verified${by}.`;
  if (to === 'REJECTED') {
    return `${publicId} was reviewed${by} and not accepted as a civic problem for action.`;
  }
  if (to === 'UNDER_REVIEW') return `${publicId} is now under review${by}.`;
  return `${publicId} is now ${label}.`;
}

type AllocationEvent = Extract<
  DomainEvent,
  {
    type:
      | 'ALLOCATION_CREATED'
      | 'ALLOCATION_ACCEPTED'
      | 'ALLOCATION_DECLINED'
      | 'ALLOCATION_CANCELLED';
  }
>;

const ALLOCATION_WORDING: Record<
  AllocationEvent['type'],
  (event: AllocationEvent) => {
    type:
      | 'ALLOCATION_REQUESTED'
      | 'ALLOCATION_ACCEPTED'
      | 'ALLOCATION_DECLINED'
      | 'ALLOCATION_CANCELLED';
    title: string;
    message: string;
  }
> = {
  ALLOCATION_CREATED: (event) => ({
    type: 'ALLOCATION_REQUESTED',
    title: 'New allocation request',
    message: `${event.governmentName} has allocated ${event.problemPublicId} to ${event.organizationName}.`,
  }),
  ALLOCATION_ACCEPTED: (event) => ({
    type: 'ALLOCATION_ACCEPTED',
    title: 'Allocation accepted',
    message: `${event.organizationName} accepted the allocation for ${event.problemPublicId}.`,
  }),
  ALLOCATION_DECLINED: (event) => ({
    type: 'ALLOCATION_DECLINED',
    title: 'Allocation declined',
    message: `${event.organizationName} declined the allocation for ${event.problemPublicId}.`,
  }),
  ALLOCATION_CANCELLED: (event) => ({
    type: 'ALLOCATION_CANCELLED',
    title: 'Allocation withdrawn',
    message: `${event.governmentName} withdrew the allocation request for ${event.problemPublicId}.`,
  }),
};

const STATUS_LABELS: Record<ProblemStatus, string> = {
  DRAFT: 'a draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  VERIFIED: 'Verified',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
  DUPLICATE: 'marked as a duplicate',
  ARCHIVED: 'Archived',
};

export function statusLabel(status: ProblemStatus): string {
  return STATUS_LABELS[status];
}

/** "PUBLIC_SAFETY" → "public safety". Words, not an enum, in a sentence. */
export function categoryLabel(category: ProblemCategory): string {
  return category.toLowerCase().replace(/_/g, ' ');
}

const PROJECT_STATUS_WORD: Record<string, string> = {
  ACTIVE: 'started',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

function projectDraft(
  event: { projectId: string; roomId: string; problemPublicId: string },
  recipientId: string,
  draft: {
    type: NotificationDraft['type'];
    title: string;
    message: string;
    dedupeKey: string;
  },
): NotificationDraft {
  return {
    recipientId,
    ...draft,
    entityType: 'RESOLUTION_PROJECT',
    entityId: event.projectId,
    metadata: { problemPublicId: event.problemPublicId, roomId: event.roomId },
  };
}
