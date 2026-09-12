'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Wrap the app once so tooltips share open/close timing. */
export function TooltipProvider({
  children,
  delayDuration = 250,
}: {
  children: ReactNode;
  delayDuration?: number;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={400}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Disables the tooltip without changing the markup around it. */
  disabled?: boolean;
}

/**
 * Tooltip for supplementary hints only.
 *
 * Tooltips do not appear on touch and are easy to miss, so anything essential
 * belongs in visible text or an `aria-label` — never here alone.
 */
export function Tooltip({ content, children, side = 'top', disabled }: TooltipProps) {
  if (disabled) return <>{children}</>;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 max-w-64 rounded-control bg-ink px-2.5 py-1.5',
            'type-caption text-ink-inverse shadow-overlay',
            'animate-scale-in',
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-ink" width={10} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
