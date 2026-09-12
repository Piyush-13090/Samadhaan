'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';

/** Shared control chrome, so Input, Textarea and Select are visually identical. */
export const controlBaseClasses = [
  'w-full rounded-control border border-border-strong bg-surface text-ink',
  'transition-[border-color,box-shadow] duration-fast ease-standard',
  'placeholder:text-ink-subtle',
  'hover:border-ink-subtle',
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
  'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-subtle',
  'aria-[invalid]:border-danger aria-[invalid]:focus:ring-danger/20',
].join(' ');

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Icon rendered inside the control on the leading edge. */
  leadingIcon?: ReactNode;
  /** Element on the trailing edge — a clear button, a unit, a shortcut hint. */
  trailingSlot?: ReactNode;
}

export function Input({ className, leadingIcon, trailingSlot, ...props }: InputProps) {
  const fieldProps = useFieldControl();

  return (
    <div className="relative flex items-center">
      {leadingIcon && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 flex text-ink-subtle [&_svg]:size-4"
        >
          {leadingIcon}
        </span>
      )}

      <input
        className={cn(
          controlBaseClasses,
          'h-10 px-3 type-body-sm',
          leadingIcon && 'pl-9',
          trailingSlot && 'pr-9',
          className,
        )}
        {...fieldProps}
        {...props}
      />

      {trailingSlot && (
        <span className="absolute right-3 flex items-center text-ink-subtle [&_svg]:size-4">
          {trailingSlot}
        </span>
      )}
    </div>
  );
}
