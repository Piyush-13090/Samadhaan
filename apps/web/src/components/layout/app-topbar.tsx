'use client';

import { LogOut, Menu, Search, Settings, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { AuthenticatedUser } from '@samadhaan/shared';
import { useAuth } from '@/components/auth/auth-provider';
import { cn } from '@/lib/cn';
import { isActivePath, type NavSection } from '@/lib/navigation';
import { ROLE_LABEL } from '@/lib/role-display';
import { Logo } from '@/components/brand/logo';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { useNotifications } from '@/components/notifications/notifications-provider';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { CountBadge } from '@/components/ui/badge';
import { Drawer, DrawerContent, DrawerClose } from '@/components/ui/drawer';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';

/**
 * Application top bar: search, notifications, profile.
 *
 * On narrow viewports the sidebar collapses into a drawer opened from here, so
 * every destination stays reachable even though the bottom bar only shows five.
 */
export function AppTopbar({
  sections,
  user,
  homeHref = '/dashboard',
  context,
}: {
  sections: NavSection[];
  user: AuthenticatedUser;
  /** Where the logo leads: the current workspace's home. */
  homeHref?: string;
  /** The organisation switcher, shown at the top of the drawer. */
  context?: ReactNode;
}) {
  const { logout, pending } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const { unreadCount } = useNotifications();

  return (
    <header
      className={cn(
        'sticky top-0 flex h-[var(--spacing-topbar)] shrink-0 items-center gap-2',
        'border-b border-border bg-surface/90 px-3 backdrop-blur-sm sm:px-4',
      )}
      style={{ zIndex: 'var(--z-topbar)' }}
    >
      {/* Drawer navigation — mobile and tablet only. */}
      <Drawer open={navOpen} onOpenChange={setNavOpen}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          className="lg:hidden"
          aria-label="Open navigation"
          onClick={() => setNavOpen(true)}
        >
          <Menu />
        </Button>

        <DrawerContent side="left" title="Navigation" hideTitle>
          <Logo size="sm" className="mb-5" />
          {context && (
            <div className="-mx-2 mb-4 border-b border-border pb-3">{context}</div>
          )}
          <nav aria-label="Main">
            {sections.map((section) => (
              <ul key={section.id} className="mb-4 space-y-0.5 last:mb-0">
                {section.label && (
                  <li
                    aria-hidden="true"
                    className="px-2.5 pb-1 type-overline text-ink-subtle"
                  >
                    {section.label}
                  </li>
                )}
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActivePath(pathname, item.href);

                  return (
                    <li key={item.href}>
                      <DrawerClose asChild>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-3 rounded-control px-2.5 py-2.5 type-body-sm',
                            active
                              ? 'bg-primary-soft font-medium text-primary'
                              : 'text-ink-muted hover:bg-subtle hover:text-ink',
                          )}
                        >
                          <Icon className="size-4.5 shrink-0" aria-hidden="true" />
                          <span className="flex-1">{item.label}</span>
                          {item.badgeKey === 'notifications' && (
                            <CountBadge count={unreadCount} />
                          )}
                        </Link>
                      </DrawerClose>
                    </li>
                  );
                })}
              </ul>
            ))}
          </nav>
        </DrawerContent>
      </Drawer>

      <Link href={homeHref} className="lg:hidden" aria-label="Samadhaan home">
        <Logo variant="mark" size="sm" />
      </Link>

      {/* Search. Presentational in this milestone — no query runs yet. */}
      <div className="ml-auto flex min-w-0 flex-1 justify-end lg:ml-0 lg:justify-start">
        <label className="relative hidden w-full max-w-sm items-center sm:flex">
          <span className="sr-only">Search problems</span>
          <Search
            className="pointer-events-none absolute left-3 size-4 text-ink-subtle"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search problems, areas, references…"
            className={cn(
              'h-9 w-full rounded-control border border-border bg-subtle/60 pr-3 pl-9',
              'type-body-sm text-ink placeholder:text-ink-subtle',
              'transition-colors duration-fast',
              'hover:bg-subtle focus:border-primary focus:bg-surface focus:outline-none',
              'focus:ring-2 focus:ring-primary/20',
            )}
          />
        </label>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          className="sm:hidden"
          aria-label="Search"
        >
          <Search />
        </Button>

        <NotificationBell />

        <Dropdown>
          <DropdownTrigger asChild>
            <button
              type="button"
              className="ml-0.5 rounded-full transition-opacity hover:opacity-85"
              aria-label="Account menu"
            >
              <Avatar name={user.fullName} src={user.avatarUrl ?? undefined} size="sm" />
            </button>
          </DropdownTrigger>

          <DropdownContent className="w-56">
            <div className="px-2 py-1.5">
              <p className="truncate type-body-sm font-medium text-ink">
                {user.fullName}
              </p>
              <p className="truncate type-caption text-ink-subtle">{user.email}</p>
              <p className="mt-1 type-overline text-primary">{ROLE_LABEL[user.role]}</p>
            </div>
            <DropdownSeparator />
            <DropdownLabel>Account</DropdownLabel>
            <DropdownItem asChild>
              <Link href="/profile">
                <User />
                Profile
              </Link>
            </DropdownItem>
            <DropdownItem asChild>
              <Link href="/settings">
                <Settings />
                Settings
              </Link>
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem
              destructive
              disabled={pending}
              // `onSelect` rather than `onClick`: Radix closes the menu on
              // select, and the async work must start before that unmount.
              onSelect={() => {
                void logout();
              }}
            >
              <LogOut />
              Sign out
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    </header>
  );
}
