'use client';

import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';
import { controlBaseClasses } from './input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Shows a live `used / max` counter. Requires `maxLength`. */
  showCount?: boolean;
}

export function Textarea({
  className,
  showCount = false,
  maxLength,
  value,
  ...props
}: TextareaProps) {
  const fieldProps = useFieldControl();
  const used = typeof value === 'string' ? value.length : 0;

  return (
    <div className="relative">
      <textarea
        className={cn(
          controlBaseClasses,
          'min-h-24 resize-y px-3 py-2.5 type-body-sm',
          showCount && maxLength && 'pb-7',
          className,
        )}
        maxLength={maxLength}
        value={value}
        {...fieldProps}
        {...props}
      />

      {showCount && maxLength && (
        <span
          className="pointer-events-none absolute right-3 bottom-2.5 type-caption tabular text-ink-subtle"
          aria-live="polite"
        >
          {used} / {maxLength}
        </span>
      )}
    </div>
  );
}
