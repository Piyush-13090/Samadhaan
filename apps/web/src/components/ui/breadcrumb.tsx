import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';
import { cn } from '@/lib/cn';

export interface BreadcrumbItem {
  label: string;
  /** Omit on the final crumb — the current page is not a link. */
  href?: string;
}

/**
 * Breadcrumb trail.
 *
 * The current page is marked `aria-current="page"` and rendered as plain text,
 * so assistive technology can tell where the user is rather than announcing a
 * link to the page they are already on.
 */
export function Breadcrumb({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 type-caption text-ink-muted">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <Fragment key={`${item.label}-${index}`}>
              <li className="min-w-0">
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className="rounded-sm transition-colors hover:text-ink"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    className={cn('truncate', isLast && 'font-medium text-ink')}
                  >
                    {item.label}
                  </span>
                )}
              </li>

              {!isLast && (
                <li aria-hidden="true" className="flex">
                  <ChevronRight className="size-3.5 text-ink-subtle" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
