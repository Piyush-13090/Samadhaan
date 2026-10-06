'use client';

import { Check, ChevronsUpDown, Inbox, LayoutGrid, UserRound } from 'lucide-react';
import Link from 'next/link';
import type { WorkspaceSummary } from '@samadhaan/shared';
import { Avatar } from '@/components/ui/avatar';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { cn } from '@/lib/cn';
import { ORGANIZATION_TYPE_LABEL, workspacePath } from '@/lib/workspace';

/**
 * Which organisation you are working as.
 *
 * The current context is always written out — avatar, name and type — so it
 * is clear whose workspace is open before anyone acts in it. With a single
 * organisation and nowhere else to go it is a plain label, not a menu: a
 * switcher with one option is noise.
 *
 * Radix supplies the menu semantics: a button with `aria-haspopup`, arrow-key
 * movement, typeahead and focus return. Each option is a link, so switching is
 * ordinary navigation and the destination page asks the API for access — the
 * menu itself grants nothing.
 */
export function WorkspaceSwitcher({
  current,
  workspaces,
  personal,
  canSwitch,
  invitationCount = 0,
  compact = false,
  className,
}: {
  /** The workspace in view; null in a personal context. */
  current: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  personal: { href: string; label: string } | null;
  canSwitch: boolean;
  invitationCount?: number;
  /** Avatar only, for the collapsed sidebar. */
  compact?: boolean;
  className?: string;
}) {
  const identity = (
    <>
      {current ? (
        <Avatar
          name={current.name}
          src={current.logoUrl ?? undefined}
          size="sm"
          className="rounded-control"
        />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-control bg-subtle text-ink-muted">
          <UserRound className="size-4" aria-hidden="true" />
        </span>
      )}
      {!compact && (
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate type-body-sm font-semibold text-ink">
            {current?.name ?? personal?.label ?? 'Organisations'}
          </span>
          <span className="block truncate type-caption text-ink-subtle">
            {current ? ORGANIZATION_TYPE_LABEL[current.type] : 'Citizen account'}
          </span>
        </span>
      )}
    </>
  );

  const showMenu = canSwitch || invitationCount > 0;

  if (!showMenu) {
    if (!current) return null;
    return (
      <div
        className={cn('flex items-center gap-2.5 rounded-control px-2 py-1.5', className)}
        aria-label={`Organisation: ${current.name}`}
        role="group"
      >
        {identity}
      </div>
    );
  }

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label={
            current
              ? `Switch organisation. Current: ${current.name}, ${ORGANIZATION_TYPE_LABEL[current.type]}`
              : 'Switch to an organisation workspace'
          }
          className={cn(
            'flex w-full items-center gap-2.5 rounded-control border border-transparent px-2 py-1.5',
            'transition-colors duration-fast hover:border-border hover:bg-subtle',
            'focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
            compact && 'justify-center px-0',
            className,
          )}
        >
          {identity}
          {!compact && (
            <ChevronsUpDown
              className="size-4 shrink-0 text-ink-subtle"
              aria-hidden="true"
            />
          )}
        </button>
      </DropdownTrigger>

      <DropdownContent align="start" className="w-72">
        <DropdownLabel>Work as</DropdownLabel>

        {personal && (
          <DropdownItem asChild>
            <Link
              href={personal.href}
              aria-current={current === null ? 'true' : undefined}
            >
              <UserRound />
              <span className="flex-1">{personal.label}</span>
              {current === null && <Check aria-hidden="true" />}
            </Link>
          </DropdownItem>
        )}

        {workspaces.map((workspace) => {
          const selected = current?.slug === workspace.slug;
          return (
            <DropdownItem key={workspace.slug} asChild>
              <Link
                href={workspacePath(workspace.slug)}
                aria-current={selected ? 'true' : undefined}
                className="items-start"
              >
                <Avatar
                  name={workspace.name}
                  src={workspace.logoUrl ?? undefined}
                  size="xs"
                  className="mt-0.5 rounded-[5px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">
                    {workspace.name}
                  </span>
                  <span className="block type-caption text-ink-subtle">
                    {ORGANIZATION_TYPE_LABEL[workspace.type]}
                    {!workspace.isAccessible && ' · Suspended'}
                  </span>
                </span>
                {selected && <Check className="mt-0.5" aria-hidden="true" />}
              </Link>
            </DropdownItem>
          );
        })}

        <DropdownSeparator />
        <DropdownItem asChild>
          <Link href="/organization">
            {invitationCount > 0 ? <Inbox /> : <LayoutGrid />}
            <span className="flex-1">
              {invitationCount > 0
                ? `Invitations (${invitationCount})`
                : 'All organisations'}
            </span>
          </Link>
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
