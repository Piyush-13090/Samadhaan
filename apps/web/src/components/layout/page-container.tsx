import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Standard content width and gutters.
 *
 * Centralised so every page shares the same rhythm — the single biggest lever
 * on whether a multi-page product feels designed or assembled.
 */
export function PageContainer({
  children,
  className,
  width = 'default',
}: {
  children: ReactNode;
  className?: string;
  /** `wide` for dashboards and feeds, `narrow` for reading and forms. */
  width?: 'default' | 'wide' | 'narrow';
}) {
  const widths = {
    narrow: 'max-w-3xl',
    default: 'max-w-6xl',
    wide: 'max-w-[90rem]',
  };

  return (
    <div
      className={cn(
        'mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10',
        widths[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeading({
  title,
  description,
  action,
  eyebrow,
  className,
}: {
  title: string;
  description?: string;
  /** Right-aligned primary action for the page. */
  action?: ReactNode;
  eyebrow?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-6 gap-y-4',
        className,
      )}
    >
      <div className="min-w-0 max-w-2xl">
        {eyebrow && <p className="type-overline text-primary">{eyebrow}</p>}
        <h1 className={cn('type-h1 text-ink', eyebrow && 'mt-1.5')}>{title}</h1>
        {description && (
          <p className="mt-2.5 type-body-lg text-ink-muted">{description}</p>
        )}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Heading for a group of cards within a page. */
export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-4 gap-y-2',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="type-h3 text-ink">{title}</h2>
        {description && <p className="mt-1 type-body-sm text-ink-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
