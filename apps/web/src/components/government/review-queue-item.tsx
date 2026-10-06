import { Copy, MapPin, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import type { GovernmentQueueItem } from '@samadhaan/shared';
import { CategoryBadge } from '@/components/problems/category-badge';
import { ProblemStatusBadge } from '@/components/problems/problem-status-badge';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import { formatCompactNumber, formatRelativeTime } from '@/lib/format';
import { governmentProblemPath } from '@/lib/government';

/**
 * One problem in the review queue: what it is, how severe, where, how long it
 * has waited, and the signals a reviewer weighs — the AI classification with
 * its own confidence (when the model reported one), possible duplicates and
 * community support. The whole card opens the review page.
 */
export function ReviewQueueItem({
  slug,
  item,
  className,
}: {
  slug: string;
  item: GovernmentQueueItem;
  className?: string;
}) {
  const place = item.area ?? item.city;

  return (
    <Card as="article" interactive className={cn('relative p-4', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono type-caption text-ink-subtle">{item.publicId}</span>
        <ProblemStatusBadge status={item.status} size="sm" />
        <SeverityBadge severity={item.severity} size="sm" />
      </div>

      <h3 className="mt-2 type-body-sm font-semibold text-ink">
        <Link
          href={governmentProblemPath(slug, item.publicId)}
          className="outline-none before:absolute before:inset-0 focus-visible:underline"
        >
          {item.title}
        </Link>
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-ink-muted">
        <CategoryBadge category={item.category} short size="sm" />
        {item.subcategory && <span>→ {item.subcategory}</span>}
        {place && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{place}</span>
          </span>
        )}
        <span>Reported {formatRelativeTime(item.createdAt)}</span>
      </div>

      <ul
        className="mt-3 flex flex-wrap gap-x-4 gap-y-1 type-caption text-ink-muted"
        aria-label="Signals"
      >
        <li className="inline-flex items-center gap-1">
          <Sparkles className="size-3.5 text-ai" aria-hidden="true" />
          {item.ai.status === 'COMPLETED' && item.ai.category
            ? `AI: ${CATEGORY_DISPLAY[item.ai.category].label}${
                item.ai.confidence !== null
                  ? ` · ${Math.round(item.ai.confidence * 100)}% confidence`
                  : ''
              }`
            : item.ai.status === 'FAILED'
              ? 'AI analysis failed'
              : item.ai.status
                ? 'AI analysis in progress'
                : 'Not analysed'}
        </li>
        {item.duplicates.possible > 0 && (
          <li className="inline-flex items-center gap-1 text-warning">
            <Copy className="size-3.5" aria-hidden="true" />
            {item.duplicates.possible} possible duplicate
            {item.duplicates.possible === 1 ? '' : 's'}
          </li>
        )}
        <li className="inline-flex items-center gap-1">
          <Users className="size-3.5" aria-hidden="true" />
          {formatCompactNumber(item.voteCount)} supporter{item.voteCount === 1 ? '' : 's'}
        </li>
      </ul>
    </Card>
  );
}
