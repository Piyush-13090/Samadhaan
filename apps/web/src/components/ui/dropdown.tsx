'use client';

import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Dropdown menu for *actions*. For selecting a value, use `Select` — the two
 * have different ARIA roles and keyboard expectations, and swapping them is a
 * common accessibility error.
 */

export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;
export const DropdownGroup = DropdownPrimitive.Group;
export const DropdownSub = DropdownPrimitive.Sub;
export const DropdownSubTrigger = DropdownPrimitive.SubTrigger;

export function DropdownContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'min-w-48 overflow-hidden rounded-card border border-border bg-overlay p-1 shadow-overlay',
          'data-[state=open]:animate-scale-in',
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownItem({
  className,
  inset,
  destructive,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Item> & {
  inset?: boolean;
  /** Red treatment for destructive actions. */
  destructive?: boolean;
}) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'relative flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2 py-1.5',
        'type-body-sm text-ink outline-none select-none',
        'transition-colors duration-instant',
        'data-[highlighted]:bg-subtle',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-subtle',
        inset && 'pl-8',
        destructive &&
          'text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.CheckboxItem>) {
  return (
    <DropdownPrimitive.CheckboxItem
      className={cn(
        'relative flex cursor-pointer items-center rounded-[6px] py-1.5 pr-2 pl-8',
        'type-body-sm text-ink outline-none select-none',
        'data-[highlighted]:bg-subtle',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DropdownPrimitive.ItemIndicator>
          <Check className="size-3.5 text-primary" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
}

export function DropdownLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Label>) {
  return (
    <DropdownPrimitive.Label
      className={cn('px-2 py-1.5 type-overline text-ink-subtle', className)}
      {...props}
    />
  );
}

export function DropdownSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Separator>) {
  return (
    <DropdownPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

/** Right-aligned keyboard shortcut hint inside a menu item. */
export function DropdownShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('ml-auto type-caption tracking-wide text-ink-subtle', className)}
      {...props}
    />
  );
}
