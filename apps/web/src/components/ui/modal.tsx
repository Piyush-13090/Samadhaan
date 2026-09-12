'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Modal dialog.
 *
 * Radix handles focus trapping, restoring focus to the trigger on close,
 * `aria-modal`, escape-to-dismiss and scroll locking — the parts that make a
 * hand-built dialog unusable with a keyboard or screen reader.
 *
 * Every modal must have a title: Radix warns loudly without one, and an
 * untitled dialog is announced as an anonymous region.
 */

export const Modal = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;

function ModalOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 bg-ink/25',
        'data-[state=open]:animate-fade-in',
        className,
      )}
      style={{ zIndex: 'var(--z-backdrop)' }}
      {...props}
    />
  );
}

export interface ModalContentProps extends React.ComponentProps<
  typeof DialogPrimitive.Content
> {
  title: string;
  description?: string;
  /** Hides the title visually while keeping it for assistive technology. */
  hideTitle?: boolean;
  size?: 'sm' | 'md' | 'lg';
  footer?: ReactNode;
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

export function ModalContent({
  className,
  title,
  description,
  hideTitle = false,
  size = 'md',
  footer,
  children,
  ...props
}: ModalContentProps) {
  return (
    <DialogPrimitive.Portal>
      <ModalOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2',
          'flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden',
          'rounded-panel border border-border bg-overlay shadow-modal',
          'data-[state=open]:animate-scale-in',
          SIZES[size],
          className,
        )}
        style={{ zIndex: 'var(--z-modal)' }}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div className={cn('min-w-0', hideTitle && 'sr-only')}>
            <DialogPrimitive.Title className="type-h4 text-ink">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 type-body-sm text-ink-muted">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>

          <DialogPrimitive.Close
            className={cn(
              'shrink-0 rounded-control p-1.5 text-ink-subtle',
              'transition-colors duration-fast hover:bg-subtle hover:text-ink',
            )}
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-subtle/50 px-5 py-3.5">
            {footer}
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
