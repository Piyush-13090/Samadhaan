'use client';

import { useEffect, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import type { NotificationFilter, NotificationView } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import {
  deleteNotification,
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
  | { status: 'ready'; items: NotificationView[]; nextCursor: string | null };

/**
 * The activity center: every notification, paged, with All / Unread.
 *
 * "Show more" rather than infinite scroll — the rest of the app pages with a
 * button, a button is reachable by keyboard and screen reader in a way a
 * scroll trigger is not, and a person reading notifications is not browsing a
 * feed.
 */
export function NotificationCenter() {
  const { unreadCount, setUnreadCount } = useNotifications();
  const { toast } = useToast();

  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    let cancelled = false;

    fetchNotifications({ filter })
      .then((page) => {
        if (cancelled) return;
        setState({ status: 'ready', items: page.items, nextCursor: page.nextCursor });
        setUnreadCount(page.unreadCount);
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [filter, attempt, setUnreadCount]);

  function changeFilter(next: string) {
    // Raised from the event, not the effect, so the skeleton paints at once.
    setState({ status: 'loading' });
    setFilter(next as NotificationFilter);
  }

  async function loadMore() {
    if (state.status !== 'ready' || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchNotifications({ filter, cursor: state.nextCursor });
      setState((current) => {
        if (current.status !== 'ready') return current;
        const seen = new Set(current.items.map((item) => item.id));
        return {
          status: 'ready',
          items: [...current.items, ...page.items.filter((item) => !seen.has(item.id))],
          nextCursor: page.nextCursor,
        };
      });
      setUnreadCount(page.unreadCount);
    } catch {
      toast({ tone: 'danger', title: "Couldn't load more notifications" });
    } finally {
      setLoadingMore(false);
    }
  }

  function open(notification: NotificationView) {
    if (notification.isRead) return;

    // Optimistic: navigation must not wait, and on failure it stays unread.
    updateItem(notification.id, { isRead: true, readAt: new Date().toISOString() });
    setUnreadCount(Math.max(0, unreadCount - 1));
    markNotificationRead(notification.id).catch(() => undefined);
  }

  async function markAll() {
    setMarkingAll(true);
    try {
      const result = await markAllNotificationsRead();
      setUnreadCount(result.unreadCount);
      setState((current) =>
        current.status !== 'ready'
          ? current
          : filter === 'unread'
            ? { ...current, items: [], nextCursor: null }
            : {
                ...current,
                items: current.items.map((item) => ({
                  ...item,
                  isRead: true,
                  readAt: item.readAt ?? new Date().toISOString(),
                })),
              },
      );
      setAnnouncement(
        result.updated === 1
          ? '1 notification marked as read.'
          : `${result.updated} notifications marked as read.`,
      );
    } catch {
      toast({ tone: 'danger', title: "Couldn't mark notifications as read" });
    } finally {
      setMarkingAll(false);
    }
  }

  async function remove(notification: NotificationView) {
    const previous = state;
    setState((current) =>
      current.status === 'ready'
        ? {
            ...current,
            items: current.items.filter((item) => item.id !== notification.id),
          }
        : current,
    );

    try {
      const result = await deleteNotification(notification.id);
      setUnreadCount(result.unreadCount);
      setAnnouncement('Notification dismissed.');
    } catch {
      setState(previous);
      toast({ tone: 'danger', title: "Couldn't dismiss the notification" });
    }
  }

  function updateItem(id: string, patch: Partial<NotificationView>) {
    setState((current) =>
      current.status === 'ready'
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === id ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={changeFilter}>
          <TabsList variant="pill" aria-label="Show notifications">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">
              Unread
              {unreadCount > 0 ? ` (${unreadCount > 99 ? '99+' : unreadCount})` : ''}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<CheckCheck />}
          loading={markingAll}
          disabled={unreadCount === 0}
          onClick={() => void markAll()}
        >
          Mark all as read
        </Button>
      </div>

      <Card className="p-1.5">
        {state.status === 'loading' ? (
          <NotificationListSkeleton rows={5} />
        ) : state.status === 'error' ? (
          <ErrorState
            title="Couldn't load notifications"
            description="Please try again in a moment."
            onRetry={() => {
              setState({ status: 'loading' });
              setAttempt((value) => value + 1);
            }}
          />
        ) : state.items.length === 0 ? (
          <NotificationEmptyState filter={filter} />
        ) : (
          <NotificationList
            notifications={state.items}
            onOpen={open}
            onDelete={(notification) => void remove(notification)}
            label={filter === 'unread' ? 'Unread notifications' : 'All notifications'}
          />
        )}
      </Card>

      {state.status === 'ready' && state.nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            loading={loadingMore}
            onClick={() => void loadMore()}
          >
            Show more
          </Button>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
