import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { Spinner } from './spinner';

/**
 * The three states every data region needs besides its happy path.
 *
 * Having them as components rather than ad-hoc markup is what keeps an empty
 * feed and an empty search result looking like the same product, and stops a
 * failed fetch rendering a blank area with no explanation.
 */

export interface EmptyStateProps {
  title: string;
  /** One sentence explaining why it is empty and what to do about it. */
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  /** `sm` for inside a card, `md` for a full page region. */
  size?: 'sm' | 'md';
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  size = 'md',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'md' ? 'px-6 py-14' : 'px-4 py-8',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex items-center justify-center rounded-full bg-subtle text-ink-subtle',
          size === 'md' ? 'size-12' : 'size-10',
        )}
      >
        <Icon className={size === 'md' ? 'size-5.5' : 'size-4.5'} />
      </span>

      <h3
        className={cn(
          'mt-4 text-ink',
          size === 'md' ? 'type-h4' : 'type-body-sm font-semibold',
        )}
      >
        {title}
      </h3>

      {description && (
        <p className="mt-1.5 max-w-sm type-body-sm text-ink-muted">{description}</p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Retry handler. Omit when the failure is not retryable. */
  onRetry?: () => void;
  /** Support reference — a request id. Never a stack trace. */
  reference?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Failure state.
 *
 * Deliberately never renders an exception message: internal detail is noise to
 * a citizen and a disclosure risk. The `reference` is what support needs.
 */
export function ErrorState({
  title = 'Something went wrong',
  description = 'We could not load this right now. Please try again.',
  onRetry,
  reference,
  size = 'md',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'md' ? 'px-6 py-14' : 'px-4 py-8',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex items-center justify-center rounded-full bg-danger-soft text-danger',
          size === 'md' ? 'size-12' : 'size-10',
        )}
      >
        <AlertTriangle className={size === 'md' ? 'size-5.5' : 'size-4.5'} />
      </span>

      <h3
        className={cn(
          'mt-4 text-ink',
          size === 'md' ? 'type-h4' : 'type-body-sm font-semibold',
        )}
      >
        {title}
      </h3>
      <p className="mt-1.5 max-w-sm type-body-sm text-ink-muted">{description}</p>

      {reference && (
        <p className="mt-2 font-mono type-caption text-ink-subtle">
          Reference: {reference}
        </p>
      )}

      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Inline loading state for a region whose final shape is not yet known. */
export function LoadingState({
  label = 'Loading',
  size = 'md',
  className,
}: {
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      aria-busy="true"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'md' ? 'px-6 py-14' : 'px-4 py-8',
        className,
      )}
    >
      <Spinner className="size-6 text-ink-subtle" label={null} />
      <p className="mt-3 type-body-sm text-ink-muted">{label}</p>
    </div>
  );
}

/** Full-page loader, for route transitions before any shell has rendered. */
export function PageLoader({ label = 'Loading Samadhaan' }: { label?: string }) {
  return (
    <div
      aria-busy="true"
      className="flex min-h-[60dvh] flex-col items-center justify-center gap-4"
    >
      <Spinner className="size-7 text-primary" label={null} />
      <p className="type-body-sm text-ink-muted">{label}</p>
    </div>
  );
}
