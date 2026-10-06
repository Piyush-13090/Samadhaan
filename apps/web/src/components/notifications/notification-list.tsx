'use client';

import type { NotificationView } from '@samadhaan/shared';
import { cn } from '@/lib/cn';
import { NotificationItem, NotificationItemSkeleton } from './notification-item';

/** A list of notifications, newest first, as the API returns them. */
export function NotificationList({
  notifications,
  onOpen,
  onDelete,
  compact = false,
  label = 'Notifications',
  className,
}: {
  notifications: NotificationView[];
  onOpen?: (notification: NotificationView) => void;
  onDelete?: (notification: NotificationView) => void;
  compact?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <ul aria-label={label} className={cn('space-y-0.5', className)}>
      {notifications.map((notification) => (
        <li key={notification.id}>
          <NotificationItem
            notification={notification}
            onOpen={onOpen}
            onDelete={onDelete}
            compact={compact}
          />
        </li>
      ))}
    </ul>
  );
}

export function NotificationListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading notifications">
      {Array.from({ length: rows }, (_, index) => (
        <NotificationItemSkeleton key={index} />
      ))}
    </div>
  );
}
