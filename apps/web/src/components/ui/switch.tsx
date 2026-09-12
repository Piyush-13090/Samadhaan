'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/cn';

/**
 * Toggle for settings that take effect immediately. For choices that only
 * apply on submit, use a Checkbox — a switch implies the change is already live.
 */
export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
        'border-2 border-transparent bg-border-strong',
        'transition-colors duration-base ease-standard',
        'data-[state=checked]:bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-surface shadow-card',
          'transition-transform duration-base ease-standard',
          'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export function SwitchField({
  label,
  description,
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  label: string;
  description?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start justify-between gap-4',
        props.disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block type-body-sm font-medium text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block type-caption text-ink-subtle">{description}</span>
        )}
      </span>
      <Switch className="mt-0.5" {...props} />
    </label>
  );
}
