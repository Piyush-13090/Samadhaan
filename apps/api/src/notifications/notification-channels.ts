import type { NotificationType } from '@samadhaan/shared';

/**
 * Delivery channels — the foundation for notification preferences.
 *
 * Only `IN_APP` exists today and it is always on. The shape is here so the
 * later work is additive rather than a rewrite:
 *
 *  - **Preferences.** A `notification_preferences` table keyed on
 *    `(userId, type, channel)` with an `enabled` flag, defaulting to the values
 *    below when no row exists. `channelsFor` reads it; nothing else changes.
 *  - **Email / push.** Each becomes a `NotificationChannelSender` that receives
 *    the already-rendered notification after the in-app row is written, from a
 *    queue rather than inline, so a slow mail provider never delays a request.
 *    The `dedupeKey` doubles as the idempotency key for those sends.
 *  - **Realtime.** A WebSocket gateway is one more consumer of the same
 *    "notification created" moment, pushing the row the bell would otherwise
 *    poll for.
 */
export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'PUSH';

/** Defaults per type. Email and push are not built, so nothing selects them. */
const DEFAULT_CHANNELS: Record<NotificationType, readonly NotificationChannel[]> = {
  AI_ANALYSIS_COMPLETED: ['IN_APP'],
  AI_ANALYSIS_FAILED: ['IN_APP'],
  POSSIBLE_DUPLICATE_FOUND: ['IN_APP'],
  PROBLEM_SUPPORTED: ['IN_APP'],
  PROBLEM_COMMENTED: ['IN_APP'],
  COMMENT_REPLIED: ['IN_APP'],
  FOLLOWED_PROBLEM_UPDATED: ['IN_APP'],
  PROBLEM_STATUS_CHANGED: ['IN_APP'],
  ALLOCATION_REQUESTED: ['IN_APP'],
  ALLOCATION_ACCEPTED: ['IN_APP'],
  ALLOCATION_DECLINED: ['IN_APP'],
  ALLOCATION_CANCELLED: ['IN_APP'],
  RESOLUTION_MESSAGE: ['IN_APP'],
  RESOLUTION_MENTION: ['IN_APP'],
  RESOLUTION_ROOM_CLOSED: ['IN_APP'],
  PROJECT_TASK_ASSIGNED: ['IN_APP'],
  PROJECT_TASK_DUE_SOON: ['IN_APP'],
  PROJECT_TASK_COMPLETED: ['IN_APP'],
  PROJECT_MILESTONE_COMPLETED: ['IN_APP'],
  PROJECT_STATUS_CHANGED: ['IN_APP'],
  PROJECT_COORDINATOR_ALERT: ['IN_APP'],
  PROJECT_COORDINATOR_QUESTION: ['IN_APP'],
  PRIORITY_ESCALATED: ['IN_APP'],
  RESOLUTION_EVIDENCE_SUBMITTED: ['IN_APP'],
  RESOLUTION_EVIDENCE_REVIEWED: ['IN_APP'],
  RESOLUTION_VERIFICATION_REQUESTED: ['IN_APP'],
  RESOLUTION_MORE_EVIDENCE_REQUESTED: ['IN_APP'],
  RESOLUTION_APPROVED: ['IN_APP'],
  RESOLUTION_REJECTED: ['IN_APP'],
  IMPACT_POINTS_AWARDED: ['IN_APP'],
  BADGE_EARNED: ['IN_APP'],
  REPUTATION_TIER_REACHED: ['IN_APP'],
};

/** The channels a notification of this type is delivered on. */
export function channelsFor(type: NotificationType): readonly NotificationChannel[] {
  return DEFAULT_CHANNELS[type];
}
