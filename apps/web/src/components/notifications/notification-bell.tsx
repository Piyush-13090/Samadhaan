'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NotificationBadge, bellLabel } from './notification-badge';
import { NotificationPopover } from './notification-popover';
import { useNotifications } from './notifications-provider';

/**
 * The bell in the top bar.
 *
 * Two forms, chosen by CSS rather than JavaScript so there is no layout shift
 * and nothing to hydrate differently:
 *
 *  - **From `sm` up**, a popover with the latest few notifications.
 *  - **On a phone**, a plain link to the activity center. A popover anchored to
 *    a 40px icon on a 360px screen is cramped and easy to dismiss by accident;
 *    the full page is the better mobile surface, and it is one tap away.
 *
 * The accessible name carries the count — "Notifications, 5 unread" — so the
 * number is announced as meaning, not as a bare digit.
 */
export function NotificationBell() {
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const label = bellLabel(unreadCount);

  const icon = (
    <>
      <Bell />
      <NotificationBadge
        count={unreadCount}
        className="pointer-events-none absolute -top-0.5 -right-0.5"
      />
    </>
  );

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        className="relative size-10 sm:hidden"
        aria-label={label}
        asChild
      >
        <Link href="/notifications">{icon}</Link>
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            className="relative hidden sm:inline-flex"
            aria-label={label}
          >
            {icon}
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
          {/* Mounted only while open, so every open shows current data. */}
          {open && <NotificationPopover onNavigate={() => setOpen(false)} />}
        </PopoverContent>
      </Popover>
    </>
  );
}
