'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { UserRole } from '@samadhaan/shared';
import { cn } from '@/lib/cn';
import { isActivePath, mobileNavigationFor } from '@/lib/navigation';

/**
 * Mobile bottom navigation.
 *
 * Not a shrunken sidebar: a phone bar holds five targets comfortably, so the
 * list is a deliberate subset, and "Report" is promoted to a raised centre
 * action. Reporting from the street with one hand is the workflow Samadhaan
 * exists for, and it should never be more than one tap away.
 *
 * The bar sits above the home indicator via `env(safe-area-inset-bottom)`, and
 * the app shell reserves matching bottom padding so it never covers content.
 */
export function MobileNav({ role = 'CITIZEN' }: { role?: UserRole }) {
  const pathname = usePathname();
  const items = mobileNavigationFor(role);

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 border-t border-border bg-surface/95 backdrop-blur-sm lg:hidden',
      )}
      style={{
        zIndex: 'var(--z-mobilenav)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <ul className="flex h-[var(--spacing-mobilenav)] items-stretch">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href);

          if (item.primary) {
            return (
              <li key={item.href} className="flex flex-1 items-center justify-center">
                <Link
                  href={item.href}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-control px-2 py-1',
                    'transition-transform duration-fast active:scale-95',
                  )}
                >
                  <span className="grid size-11 -translate-y-3 place-items-center rounded-[14px] bg-primary text-ink-inverse shadow-raised">
                    <Plus className="size-5.5" aria-hidden="true" strokeWidth={2.5} />
                  </span>
                  <span className="-mt-3 type-overline tracking-normal text-primary">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          }

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex size-full flex-col items-center justify-center gap-1',
                  'transition-colors duration-fast',
                  active ? 'text-primary' : 'text-ink-subtle',
                )}
              >
                <span className="relative">
                  <Icon
                    className="size-5"
                    aria-hidden="true"
                    strokeWidth={active ? 2.4 : 2}
                  />
                </span>
                <span
                  className={cn(
                    'type-overline tracking-normal',
                    active && 'font-semibold',
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
