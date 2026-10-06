import type {
  MarkAllReadResult,
  NotificationFilter,
  NotificationPage,
  NotificationView,
  UnreadCount,
} from '@samadhaan/shared';
import { api } from '@/lib/api';

/**
 * The signed-in user's notifications.
 *
 * Nothing here names a recipient: the session cookie is the only identity the
 * API accepts, so these calls can only ever reach the caller's own.
 */

export function fetchNotifications(
  query: { cursor?: string; limit?: number; filter?: NotificationFilter } = {},
): Promise<NotificationPage> {
  return api.get<NotificationPage>('/notifications', {
    query: { ...query },
    cache: 'no-store',
  });
}

export function fetchUnreadCount(): Promise<UnreadCount> {
  return api.get<UnreadCount>('/notifications/unread-count', { cache: 'no-store' });
}

export function markNotificationRead(id: string): Promise<NotificationView> {
  return api.patch<NotificationView>(`/notifications/${encodeURIComponent(id)}/read`);
}

export function markAllNotificationsRead(): Promise<MarkAllReadResult> {
  return api.patch<MarkAllReadResult>('/notifications/read-all');
}

export function deleteNotification(id: string): Promise<{ unreadCount: number }> {
  return api.delete<{ unreadCount: number }>(`/notifications/${encodeURIComponent(id)}`);
}
