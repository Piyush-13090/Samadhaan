'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

/**
 * Tabs with roving focus and arrow-key navigation from Radix.
 *
 * The underline variant is the default: it costs less visual weight than a
 * filled pill row, which matters on pages that already carry a lot of chrome.
 */

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  variant = 'underline',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: 'underline' | 'pill';
}) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex items-center gap-1 overflow-x-auto',
        variant === 'underline' && 'border-b border-border',
        variant === 'pill' && 'w-fit rounded-control bg-subtle p-1',
        className,
      )}
      data-variant={variant}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative shrink-0 whitespace-nowrap type-body-sm font-medium text-ink-muted',
        'transition-colors duration-fast ease-standard',
        'disabled:pointer-events-none disabled:opacity-45',
        'hover:text-ink',
        // Underline variant
        'group-data-[variant=underline]:px-3 group-data-[variant=underline]:py-2.5',
        '[[data-variant=underline]_&]:-mb-px [[data-variant=underline]_&]:border-b-2',
        '[[data-variant=underline]_&]:border-transparent [[data-variant=underline]_&]:px-3',
        '[[data-variant=underline]_&]:py-2.5',
        '[[data-variant=underline]_&][data-state=active]:border-primary',
        '[[data-variant=underline]_&][data-state=active]:text-ink',
        // Pill variant
        '[[data-variant=pill]_&]:rounded-[6px] [[data-variant=pill]_&]:px-3',
        '[[data-variant=pill]_&]:py-1.5',
        '[[data-variant=pill]_&][data-state=active]:bg-surface',
        '[[data-variant=pill]_&][data-state=active]:text-ink',
        '[[data-variant=pill]_&][data-state=active]:shadow-card',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('mt-5 focus-visible:outline-none', className)}
      {...props}
    />
  );
}
