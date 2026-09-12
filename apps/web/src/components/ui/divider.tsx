'use client';

import * as SeparatorPrimitive from '@radix-ui/react-separator';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Divider. Decorative by default — a purely visual rule must not be announced
 * as a semantic separator, which is the accessibility mistake `<hr>` invites.
 */
export function Divider({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      decorative={decorative}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

/** Horizontal rule with centred text, for separating sections or options. */
export function DividerWithLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span className="type-caption text-ink-subtle">{children}</span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}
