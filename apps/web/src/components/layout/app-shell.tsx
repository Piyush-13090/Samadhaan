'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, type ReactNode } from 'react';
import type {
  AuthenticatedUser,
  GovernmentWorkspaceSummary,
  MyOrganizations,
} from '@samadhaan/shared';
import { usePersistedBoolean, usePersistedString } from '@/hooks/use-persisted-boolean';
import { resolveShellContext } from '@/lib/shell-context';
import { LAST_WORKSPACE_STORAGE_KEY } from '@/lib/workspace';
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher';
import {
  NotificationsProvider,
  useNotifications,
} from '@/components/notifications/notifications-provider';
import { AppSidebar } from './app-sidebar';
import { AppTopbar } from './app-topbar';
import { MobileNav } from './mobile-nav';

const COLLAPSE_STORAGE_KEY = 'samadhaan:sidebar-collapsed';

/**
 * The authenticated application shell: sidebar, top bar and mobile bottom bar
 * around a content column.
 *
 * `user` is the authenticated session resolved on the server, and its role
 * selects the navigation: a citizen sees the reporting workspace, government
 * and admin see theirs. Inside `/organization/:slug` the navigation is that
 * organisation's workspace, and `organizations` (the user's memberships) feeds
 * the switcher — see `resolveShellContext`. None of it is authorisation; every
 * page asks the API.
 *
 * Notifications are real: `NotificationsProvider` holds the unread count for
 * the bell, the sidebar and the drawer, so all three agree.
 */
const NO_ORGANIZATIONS: MyOrganizations = { workspaces: [], invitations: [] };

export function AppShell({
  children,
  user,
  organizations = NO_ORGANIZATIONS,
  governmentOffices = [],
}: {
  children: ReactNode;
  user: AuthenticatedUser;
  organizations?: MyOrganizations;
  governmentOffices?: GovernmentWorkspaceSummary[];
}) {
  return (
    <NotificationsProvider>
      <ShellLayout
        user={user}
        organizations={organizations}
        governmentOffices={governmentOffices}
      >
        {children}
      </ShellLayout>
    </NotificationsProvider>
  );
}

function ShellLayout({
  children,
  user,
  organizations,
  governmentOffices,
}: {
  children: ReactNode;
  user: AuthenticatedUser;
  organizations: MyOrganizations;
  governmentOffices: GovernmentWorkspaceSummary[];
}) {
  const { unreadCount } = useNotifications();
  const pathname = usePathname();
  const [rememberedSlug, setRememberedSlug] = usePersistedString(
    LAST_WORKSPACE_STORAGE_KEY,
  );

  const context = resolveShellContext({
    role: user.role,
    pathname,
    organizations,
    rememberedSlug,
    governmentOffices,
  });

  // Remember the workspace in view, so pages outside it (notifications, the
  // map) keep its navigation. Only a workspace the user belongs to is kept.
  const viewedSlug = context.workspace?.slug ?? null;
  useEffect(() => {
    if (viewedSlug && viewedSlug !== rememberedSlug) setRememberedSlug(viewedSlug);
  }, [viewedSlug, rememberedSlug, setRememberedSlug]);

  // Renders expanded on the server, then adopts the stored preference on the
  // client — `usePersistedBoolean` handles that split so hydration stays clean.
  const [collapsed, setCollapsed] = usePersistedBoolean(COLLAPSE_STORAGE_KEY, false);

  const toggleCollapsed = useCallback(
    () => setCollapsed(!collapsed),
    [collapsed, setCollapsed],
  );

  const switcher = (compact: boolean) =>
    context.workspace || context.canSwitch || organizations.invitations.length > 0 ? (
      <WorkspaceSwitcher
        current={context.workspace}
        workspaces={organizations.workspaces}
        personal={context.personal}
        canSwitch={context.canSwitch}
        invitationCount={organizations.invitations.length}
        compact={compact}
      />
    ) : null;

  return (
    <div className="flex min-h-dvh">
      <AppSidebar
        sections={context.sections}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        unreadCount={unreadCount}
        homeHref={context.homeHref}
        context={switcher(collapsed)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar
          sections={context.sections}
          user={user}
          homeHref={context.homeHref}
          context={switcher(false)}
        />

        {/* Bottom padding clears the mobile bar; removed once it is hidden. */}
        <main
          id="main"
          className="flex-1 pb-[calc(var(--spacing-mobilenav)+env(safe-area-inset-bottom))] lg:pb-0"
        >
          {children}
        </main>
      </div>

      <MobileNav items={context.mobileItems} />
    </div>
  );
}
