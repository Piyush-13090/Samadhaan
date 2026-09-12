'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from '@/lib/cn';

export const RadioGroup = RadioGroupPrimitive.Root;

export function Radio({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'size-4.5 shrink-0 rounded-full border border-border-strong bg-surface',
        'transition-colors duration-fast ease-standard',
        'hover:border-ink-subtle',
        'data-[state=checked]:border-primary data-[state=checked]:border-[5px]',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export function RadioField({
  label,
  description,
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item> & {
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
      <Radio className="mt-0.5" {...props} />
      <span className="min-w-0">
        <span className="block type-body-sm text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block type-caption text-ink-subtle">{description}</span>
        )}
      </span>
    </label>
  );
}
