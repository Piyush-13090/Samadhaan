'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Checkbox with a real indeterminate state — `checked="indeterminate"` renders
 * a dash and reports `aria-checked="mixed"`, which "select all" headers need.
 */
export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-4.5 shrink-0 rounded-[5px] border border-border-strong bg-surface',
        'transition-colors duration-fast ease-standard',
        'hover:border-ink-subtle',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-ink-inverse">
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3.5" strokeWidth={3} />
        ) : (
          <Check className="size-3.5" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** Checkbox with an adjacent label; the whole row is the hit target. */
export function CheckboxField({
  label,
  description,
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  label: string;
  description?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5',
        props.disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <Checkbox className="mt-0.5" {...props} />
      <span className="min-w-0">
        <span className="block type-body-sm text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block type-caption text-ink-subtle">{description}</span>
        )}
      </span>
    </label>
  );
}
