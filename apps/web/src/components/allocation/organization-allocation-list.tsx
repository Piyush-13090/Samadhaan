import { ArrowRight, Inbox, MapPin } from 'lucide-react';
import Link from 'next/link';
import {
  ALLOCATION_VIEWS,
  type AllocationView,
  type OrganizationAllocationPage,
} from '@samadhaan/shared';
import { CategoryBadge } from '@/components/problems/category-badge';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { ALLOCATION_VIEW_LABEL, allocationPath } from '@/lib/allocation';
import { cn } from '@/lib/cn';
import { roomPath } from '@/lib/resolution';
import { formatRelativeTime, formatDateTime } from '@/lib/format';
import { AllocationStatusBadge } from './allocation-status-badge';

const EMPTY: Record<AllocationView, { title: string; description: string }> = {
  pending: {
    title: 'No allocation requests waiting',
    description:
      'When a government office allocates a verified problem to your organisation, it appears here for an owner or admin to accept or decline.',
  },
  active: {
    title: 'No accepted allocations',
    description:
      'Problems your organisation has accepted from a government office appear here.',
  },
  past: {
    title: 'Nothing closed yet',
    description: 'Declined and withdrawn allocation requests appear here.',
  },
  all: {
    title: 'No allocation requests yet',
    description:
      'Government offices allocate verified problems to organisations. Requests to yours will appear here.',
  },
};

/**
 * The organisation's allocation inbox. Views are links, so each is a URL a
 * member can share or reload; the server renders the page.
 */
export function OrganizationAllocationList({
  slug,
  view,
  data,
}: {
  slug: string;
  view: AllocationView;
  data: OrganizationAllocationPage;
}) {
  const base = allocationPath(slug);

  return (
    <div className="space-y-5">
      <nav
        aria-label="Allocation views"
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {ALLOCATION_VIEWS.map((entry) => (
          <Link
            key={entry}
            href={`${base}?view=${entry}`}
            aria-current={entry === view ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 type-body-sm font-medium transition-colors',
              entry === view
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {ALLOCATION_VIEW_LABEL[entry]}
          </Link>
        ))}
      </nav>

      {data.items.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox} {...EMPTY[view]} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {data.items.map((item) => {
            const place = [item.problem.area, item.problem.city]
              .filter(Boolean)
              .join(', ');
            return (
              <li key={item.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono type-caption text-ink-subtle">
                      {item.problem.publicId}
                    </span>
                    <AllocationStatusBadge status={item.status} size="sm" />
                    <SeverityBadge severity={item.problem.severity} size="sm" />
                  </div>
                  <h2 className="mt-2 type-body font-semibold text-ink">
                    <Link
                      href={allocationPath(slug, item.id)}
                      className="underline-offset-2 hover:underline"
                    >
                      {item.problem.title}
                    </Link>
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-ink-muted">
                    <CategoryBadge category={item.problem.category} size="sm" />
                    {place && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden="true" />
                        {place}
                      </span>
                    )}
                    <span>
                      From {item.government.name} ·{' '}
                      <time
                        dateTime={item.proposedAt}
                        title={formatDateTime(item.proposedAt)}
                      >
                        {formatRelativeTime(item.proposedAt)}
                      </time>
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                    {item.roomId && (
                      <Link
                        href={roomPath(item.roomId)}
                        className="inline-flex items-center gap-1 type-body-sm font-medium text-primary underline-offset-2 hover:underline"
                      >
                        Open Resolution Room
                        <span className="sr-only">: {item.problem.title}</span>
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    )}
                    <Link
                      href={allocationPath(slug, item.id)}
                      className="inline-flex items-center gap-1 type-body-sm font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {item.status === 'PENDING' ? 'Review request' : 'View details'}
                      <span className="sr-only">: {item.problem.title}</span>
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {data.totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between type-body-sm"
        >
          {data.page > 1 ? (
            <Link
              href={`${base}?view=${view}&page=${data.page - 1}`}
              className="font-medium text-primary"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-muted">
            Page {data.page} of {data.totalPages}
          </span>
          {data.page < data.totalPages ? (
            <Link
              href={`${base}?view=${view}&page=${data.page + 1}`}
              className="font-medium text-primary"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
