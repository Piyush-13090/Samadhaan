'use client';

import { useCallback, type ReactNode } from 'react';
import type { AuthenticatedUser } from '@samadhaan/shared';
import { usePersistedBoolean } from '@/hooks/use-persisted-boolean';
import { navigationFor } from '@/lib/navigation';
import type { NotificationSummary } from '@/types/domain';
import { AppSidebar } from './app-sidebar';
import { AppTopbar } from './app-topbar';
import { MobileNav } from './mobile-nav';

const COLLAPSE_STORAGE_KEY = 'samadhaan:sidebar-collapsed';

/**
 * The authenticated application shell: sidebar, top bar and mobile bottom bar
 * around a content column.
 *
 * `user` is the authenticated session resolved on the server, and its role
 * selects the navigation: a citizen sees the reporting workspace, an
 * organisation sees theirs, government and admin see theirs. Adding a role's
 * workspace is a change to `lib/navigation.ts`, not to this file.
 *
 * Notifications are still fixtures — that milestone has not landed.
 */
export function AppShell({
  children,
  user,
  notifications,
}: {
  children: ReactNode;
  user: AuthenticatedUser;
  notifications: NotificationSummary[];
}) {
  // Renders expanded on the server, then adopts the stored preference on the
  // client — `usePersistedBoolean` handles that split so hydration stays clean.
  const [collapsed, setCollapsed] = usePersistedBoolean(COLLAPSE_STORAGE_KEY, false);

  const toggleCollapsed = useCallback(
    () => setCollapsed(!collapsed),
    [collapsed, setCollapsed],
  );

  const sections = navigationFor(user.role);
  const unreadCount = notifications.filter((entry) => !entry.read).length;

  return (
    <div className="flex min-h-dvh">
      <AppSidebar
        sections={sections}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        unreadCount={unreadCount}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar sections={sections} user={user} notifications={notifications} />

        {/* Bottom padding clears the mobile bar; removed once it is hidden. */}
        <main
          id="main"
          className="flex-1 pb-[calc(var(--spacing-mobilenav)+env(safe-area-inset-bottom))] lg:pb-0"
        >
          {children}
        </main>
      </div>

      <MobileNav role={user.role} />
    </div>
  );
}
