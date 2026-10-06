'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchUnreadCount } from '@/services/notifications.service';

/**
 * The unread count, shared by everything in the shell that shows it — the
 * bell, the sidebar badge, the drawer — and updated by everything that changes
 * it, so marking one read in the activity center moves the bell at once.
 *
 * **Polling, not push.** The count is re-read every minute while the tab is
 * visible, and immediately when the tab regains focus — which is when a person
 * actually looks. A notification may therefore appear up to a minute late,
 * which is fine for civic updates. When a WebSocket gateway exists it calls
 * `setUnreadCount` with a pushed value and the interval is dropped; nothing
 * that reads the count changes.
 */

export const UNREAD_POLL_INTERVAL_MS = 60_000;

interface NotificationsContextValue {
  unreadCount: number;
  /** Re-reads the count from the server. */
  refresh: () => Promise<void>;
  /** Applies a count the server just returned from a write. */
  setUnreadCount: (count: number) => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context)
    throw new Error('useNotifications must be used within <NotificationsProvider>');
  return context;
}

export function NotificationsProvider({
  children,
  pollIntervalMs = UNREAD_POLL_INTERVAL_MS,
}: {
  children: ReactNode;
  pollIntervalMs?: number;
}) {
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { count } = await fetchUnreadCount();
      setUnreadCount(count);
    } catch {
      // A badge that is briefly stale is better than one that errors. The
      // next poll or focus tries again.
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the first read is not a synchronous state update in
    // the effect body.
    const initial = setTimeout(() => void refresh(), 0);

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, pollIntervalMs);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, pollIntervalMs]);

  const value = useMemo(
    () => ({ unreadCount, refresh, setUnreadCount }),
    [unreadCount, refresh],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}
