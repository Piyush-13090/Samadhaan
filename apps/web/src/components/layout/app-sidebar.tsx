'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import {
  SECONDARY_NAV,
  isActivePath,
  type NavItem,
  type NavSection,
} from '@/lib/navigation';
import { Logo } from '@/components/brand/logo';
import { CountBadge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * Desktop sidebar.
 *
 * Light and quiet by design — it is scaffolding, not content. The active item
 * is marked with a tinted background plus a left rule, so it stays identifiable
 * when collapsed to icons and without relying on colour.
 */
export function AppSidebar({
  sections,
  collapsed,
  onToggleCollapsed,
  unreadCount = 0,
}: {
  sections: NavSection[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  unreadCount?: number;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface lg:flex',
        'transition-[width] duration-base ease-standard',
        collapsed ? 'w-[var(--spacing-sidebar-collapsed)]' : 'w-[var(--spacing-sidebar)]',
      )}
      style={{ zIndex: 'var(--z-sidebar)' }}
    >
      <div
        className={cn(
          'flex h-[var(--spacing-topbar)] shrink-0 items-center border-b border-border',
          collapsed ? 'justify-center px-2' : 'px-4',
        )}
      >
        <Link href="/dashboard" aria-label="Samadhaan home">
          <Logo variant={collapsed ? 'mark' : 'full'} size="sm" />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2.5 py-4">
        {sections.map((section) => (
          <div key={section.id} className="mb-5 last:mb-0">
            {section.label && !collapsed && (
              <h2 className="px-2.5 pb-1.5 type-overline text-ink-subtle">
                {section.label}
              </h2>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  active={isActivePath(pathname, item.href)}
                  badgeCount={item.badgeKey === 'notifications' ? unreadCount : 0}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border px-2.5 py-3">
        <ul className="space-y-0.5">
          {SECONDARY_NAV.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              collapsed={collapsed}
              active={isActivePath(pathname, item.href)}
            />
          ))}
        </ul>

        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'mt-1 flex w-full items-center gap-3 rounded-control px-2.5 py-2',
            'type-body-sm text-ink-subtle transition-colors duration-fast',
            'hover:bg-subtle hover:text-ink',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4.5 shrink-0" />
          ) : (
            <>
              <PanelLeftClose className="size-4.5 shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

function SidebarLink({
  item,
  collapsed,
  active,
  badgeCount = 0,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  badgeCount?: number;
}) {
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-3 rounded-control px-2.5 py-2',
        'type-body-sm transition-colors duration-fast ease-standard',
        active
          ? 'bg-primary-soft font-medium text-primary'
          : 'text-ink-muted hover:bg-subtle hover:text-ink',
        collapsed && 'justify-center px-0',
      )}
    >
      {/* Left rule reinforces the active state without relying on the tint. */}
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
        />
      )}

      <Icon className="size-4.5 shrink-0" aria-hidden="true" />

      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}

      {badgeCount > 0 &&
        (collapsed ? (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 size-2 rounded-full bg-danger ring-2 ring-surface"
          />
        ) : (
          <CountBadge count={badgeCount} />
        ))}
    </Link>
  );

  return (
    <li>
      {collapsed ? (
        <Tooltip content={item.label} side="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}
