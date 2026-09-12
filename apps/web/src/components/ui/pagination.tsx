'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';

/**
 * Page-number pagination.
 *
 * Note for later milestones: the problem feed uses cursor pagination (the API's
 * `nextCursor`), so this component is for bounded, countable lists — admin
 * tables, leaderboards — where a user genuinely benefits from jumping to a page.
 */

/** Builds the page list with ellipses: `1 … 4 5 6 … 20`. */
function buildPageList(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages: Array<number | 'gap'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) pages.push('gap');
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < total - 1) pages.push('gap');

  pages.push(total);
  return pages;
}

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center justify-center gap-1', className)}
    >
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft />
      </Button>

      {buildPageList(page, totalPages).map((entry, index) =>
        entry === 'gap' ? (
          <span
            key={`gap-${index}`}
            aria-hidden="true"
            className="px-1.5 type-body-sm text-ink-subtle"
          >
            …
          </span>
        ) : (
          <Button
            key={entry}
            variant={entry === page ? 'subtle' : 'ghost'}
            size="sm"
            className="min-w-8 tabular"
            aria-label={`Page ${entry}`}
            aria-current={entry === page ? 'page' : undefined}
            onClick={() => onPageChange(entry)}
          >
            {entry}
          </Button>
        ),
      )}

      <Button
        variant="ghost"
        size="sm"
        iconOnly
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight />
      </Button>
    </nav>
  );
}
