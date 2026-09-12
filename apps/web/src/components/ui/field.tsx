'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Wraps a form control with its label, hint and error, and wires the ARIA
 * relationships between them.
 *
 * Controls read the generated ids from context, so a caller writes
 * `<Field label="Email"><Input /></Field>` and gets correct `id`,
 * `aria-describedby` and `aria-invalid` without repeating them — the part
 * hand-written forms reliably get wrong.
 */

interface FieldContextValue {
  controlId: string;
  descriptionId?: string;
  errorId?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export function useFieldControl(): {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
} {
  const field = useContext(FieldContext);
  if (!field) return {};

  const describedBy = [field.errorId, field.descriptionId].filter(Boolean).join(' ');

  return {
    id: field.controlId,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': field.invalid || undefined,
    // `aria-required` rather than the native attribute: it announces the
    // requirement without handing validation to the browser, whose default
    // bubbles would bypass this component's error presentation.
    'aria-required': field.required || undefined,
  };
}

export interface FieldProps {
  label: string;
  /** Helper text shown under the control. Hidden while an error is showing. */
  hint?: string;
  error?: string;
  /** Renders a required marker and applies `aria-required` to the control. */
  required?: boolean;
  /** Visually hides the label while keeping it available to screen readers. */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  hideLabel = false,
  className,
  children,
}: FieldProps) {
  const baseId = useId();
  const controlId = `${baseId}-control`;
  const descriptionId = hint ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;

  return (
    <FieldContext.Provider
      value={{ controlId, descriptionId, errorId, invalid: Boolean(error), required }}
    >
      <div className={cn('flex flex-col gap-1.5', className)}>
        <LabelPrimitive.Root
          htmlFor={controlId}
          className={cn('type-label text-ink', hideLabel && 'sr-only')}
        >
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </LabelPrimitive.Root>

        {children}

        {/* The error replaces the hint rather than stacking, so the control
            never shifts position as validation state changes. */}
        {error ? (
          <p id={errorId} role="alert" className="type-caption text-danger">
            {error}
          </p>
        ) : hint ? (
          <p id={descriptionId} className="type-caption text-ink-subtle">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/** Standalone label, for controls not wrapped in a `Field`. */
export function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root className={cn('type-label text-ink', className)} {...props} />
  );
}
