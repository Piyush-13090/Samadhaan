/**
 * Notification contracts — the activity center, the popover and the bell.
 *
 * A notification is about something that happened to *the recipient's*
 * activity: their report was analysed, supported or discussed, a reply landed
 * under their comment, a problem they follow moved. Every endpoint is scoped to
 * the signed-in user; no request can name a recipient.
 */

/**
 * Mirrors the `NotificationType` enum. Only events the product produces today —
 * allocation, resolution and impact add their own types when they exist.
 */
export const NOTIFICATION_TYPES = [
  'AI_ANALYSIS_COMPLETED',
  'AI_ANALYSIS_FAILED',
  'POSSIBLE_DUPLICATE_FOUND',
  'PROBLEM_SUPPORTED',
  'PROBLEM_COMMENTED',
  'COMMENT_REPLIED',
  'FOLLOWED_PROBLEM_UPDATED',
  'PROBLEM_STATUS_CHANGED',
  'ALLOCATION_REQUESTED',
  'ALLOCATION_ACCEPTED',
  'ALLOCATION_DECLINED',
  'ALLOCATION_CANCELLED',
  'RESOLUTION_MESSAGE',
  'RESOLUTION_MENTION',
  'RESOLUTION_ROOM_CLOSED',
  'PROJECT_TASK_ASSIGNED',
  'PROJECT_TASK_DUE_SOON',
  'PROJECT_TASK_COMPLETED',
  'PROJECT_MILESTONE_COMPLETED',
  'PROJECT_STATUS_CHANGED',
  'PROJECT_COORDINATOR_ALERT',
  'PROJECT_COORDINATOR_QUESTION',
  'PRIORITY_ESCALATED',
  'RESOLUTION_EVIDENCE_SUBMITTED',
  'RESOLUTION_EVIDENCE_REVIEWED',
  'RESOLUTION_VERIFICATION_REQUESTED',
  'RESOLUTION_MORE_EVIDENCE_REQUESTED',
  'RESOLUTION_APPROVED',
  'RESOLUTION_REJECTED',
  'IMPACT_POINTS_AWARDED',
  'BADGE_EARNED',
  'REPUTATION_TIER_REACHED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_ENTITY_TYPES = [
  'PROBLEM',
  'COMMENT',
  'DUPLICATE',
  'SYSTEM',
  'ALLOCATION',
  'RESOLUTION_ROOM',
  'RESOLUTION_PROJECT',
] as const;

export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

/** Notifications per page in the activity center. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** Largest page the API will return. */
export const NOTIFICATIONS_MAX_PAGE_SIZE = 50;

/** How many the bell's popover shows. */
export const NOTIFICATIONS_POPOVER_SIZE = 5;

export const NOTIFICATION_FILTERS = ['all', 'unread'] as const;

export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  /**
   * Where opening the notification goes. Built by the server from validated
   * data — never a URL stored in the row — so it is always an in-app path.
   */
  href: string;
  /** The problem it concerns, e.g. `SAM-1023`, when there is one. */
  problemPublicId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationView[];
  nextCursor: string | null;
  /** Unread total, so a list and the bell agree after one request. */
  unreadCount: number;
}

export interface UnreadCount {
  count: number;
}

export interface MarkAllReadResult {
  /** How many were unread and are now read. */
  updated: number;
  unreadCount: number;
}
