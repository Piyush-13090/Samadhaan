'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Edge-anchored panel, built on the same dialog primitive as `Modal` so it
 * inherits focus trapping and dismissal behaviour.
 *
 * Used for the mobile navigation sheet and for filter panels that should not
 * take over the whole screen.
 */

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

const SIDE_STYLES = {
  left: 'inset-y-0 left-0 h-full w-[min(20rem,85vw)] border-r',
  right: 'inset-y-0 right-0 h-full w-[min(20rem,85vw)] border-l',
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] w-full rounded-t-panel border-t',
} as const;

export interface DrawerContentProps extends React.ComponentProps<
  typeof DialogPrimitive.Content
> {
  title: string;
  description?: string;
  hideTitle?: boolean;
  side?: keyof typeof SIDE_STYLES;
  footer?: ReactNode;
}

export function DrawerContent({
  className,
  title,
  description,
  hideTitle = false,
  side = 'right',
  footer,
  children,
  ...props
}: DrawerContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className="fixed inset-0 bg-ink/25 data-[state=open]:animate-fade-in"
        style={{ zIndex: 'var(--z-backdrop)' }}
      />
      <DialogPrimitive.Content
        className={cn(
          'fixed flex flex-col overflow-hidden border-border bg-overlay shadow-modal',
          'data-[state=open]:animate-slide-up',
          SIDE_STYLES[side],
          className,
        )}
        style={{ zIndex: 'var(--z-drawer)' }}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3.5">
          <div className={cn('min-w-0', hideTitle && 'sr-only')}>
            <DialogPrimitive.Title className="type-h4 text-ink">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-0.5 type-caption text-ink-muted">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="shrink-0 rounded-control p-1.5 text-ink-subtle transition-colors hover:bg-subtle hover:text-ink">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

        {footer && (
          <div className="border-t border-border bg-subtle/50 px-4 py-3">{footer}</div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
