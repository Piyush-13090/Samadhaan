'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { NOTIFICATIONS_POPOVER_SIZE, type NotificationView } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/notifications.service';
import { NotificationEmptyState } from './notification-empty-state';
import { NotificationList, NotificationListSkeleton } from './notification-list';
import { useNotifications } from './notifications-provider';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: NotificationView[] };

/**
 * The bell's popover: the latest few notifications and a way to the rest.
 *
 * Fetches only `NOTIFICATIONS_POPOVER_SIZE` rows, and only when opened — the
 * shell never loads notifications up front. Mounted fresh on every open, so it
 * always shows what is current.
 */
export function NotificationPopover({ onNavigate }: { onNavigate?: () => void }) {
  const { unreadCount, setUnreadCount } = useNotifications();
  const { toast } = useToast();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchNotifications({ limit: NOTIFICATIONS_POPOVER_SIZE })
      .then((page) => {
        if (cancelled) return;
        setState({ status: 'ready', items: page.items });
        setUnreadCount(page.unreadCount);
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, setUnreadCount]);

  function open(notification: NotificationView) {
    onNavigate?.();
    if (notification.isRead) return;

    // Optimistic, and fire-and-forget: navigation must not wait on it, and if
    // it fails the notification simply stays unread.
    setUnreadCount(Math.max(0, unreadCount - 1));
    markNotificationRead(notification.id).catch(() => undefined);
  }

  async function markAll() {
    setMarkingAll(true);
    try {
      const result = await markAllNotificationsRead();
      setUnreadCount(result.unreadCount);
      setState((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              items: current.items.map((item) => ({
                ...item,
                isRead: true,
                readAt: item.readAt ?? new Date().toISOString(),
              })),
            }
          : current,
      );
    } catch {
      toast({ tone: 'danger', title: "Couldn't mark notifications as read" });
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="type-h4 text-ink">Notifications</h2>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            loading={markingAll}
            onClick={() => void markAll()}
          >
            Mark all as read
          </Button>
        )}
      </div>

      <div className="max-h-[min(24rem,60vh)] overflow-y-auto p-1.5">
        {state.status === 'loading' ? (
          <NotificationListSkeleton rows={3} />
        ) : state.status === 'error' ? (
          <ErrorState
            size="sm"
            title="Couldn't load notifications"
            description="Please try again."
            onRetry={() => {
              setState({ status: 'loading' });
              setAttempt((value) => value + 1);
            }}
          />
        ) : state.items.length === 0 ? (
          <NotificationEmptyState size="sm" />
        ) : (
          <NotificationList
            notifications={state.items}
            onOpen={open}
            compact
            label="Latest notifications"
          />
        )}
      </div>

      <div className="border-t border-border p-2">
        <Button variant="ghost" size="sm" fullWidth asChild>
          <Link href="/notifications" onClick={onNavigate}>
            View all notifications
          </Link>
        </Button>
      </div>
    </div>
  );
}
