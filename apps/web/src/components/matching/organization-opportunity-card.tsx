import { ArrowRight, Check, EyeOff, MapPin, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import type { RecommendationItem } from '@samadhaan/shared';
import { CategoryBadge } from '@/components/problems/category-badge';
import { ProblemStatusBadge } from '@/components/problems/problem-status-badge';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import { formatDistance, formatRelativeTime } from '@/lib/format';
import { describeReason } from '@/lib/matching';
import { RelevanceIndicator } from './relevance-indicator';

/**
 * A recommended civic opportunity in an organisation's workspace.
 *
 * Shows why the matching engine thinks this organisation is relevant — the
 * score, the matched areas of work, the reasons — and links to the problem.
 * There is deliberately no "apply" or "accept": a recommendation is not an
 * assignment, and those workflows do not exist yet. Owners and admins can
 * mark it not relevant, which only hides it for their organisation.
 */
export function OrganizationOpportunityCard({
  item,
  onDismiss,
  onRestore,
  busy = false,
  className,
}: {
  item: RecommendationItem;
  /** Present only for members allowed to dismiss. */
  onDismiss?: () => void;
  onRestore?: () => void;
  busy?: boolean;
  className?: string;
}) {
  const { match } = item;
  const locality = item.area ?? item.city;
  const aiSubcategory = item.ai?.subcategory;

  return (
    <Card as="article" className={className}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono type-caption text-ink-subtle">{item.publicId}</span>
          <ProblemStatusBadge status={item.status} size="sm" />
          <SeverityBadge severity={item.severity} size="sm" />
          {match.status === 'STALE' && (
            <span className="ml-auto type-caption text-ink-subtle">Being refreshed</span>
          )}
        </div>

        <h3 className="type-body-sm font-semibold text-ink">{item.title}</h3>

        <RelevanceIndicator relevance={match.relevance} />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 type-caption text-ink-muted">
          <CategoryBadge category={item.category} short size="sm" />
          {aiSubcategory && (
            <span>
              {CATEGORY_DISPLAY[item.category].label} → {aiSubcategory}
            </span>
          )}
          {locality && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{locality}</span>
            </span>
          )}
          {item.distanceMeters !== null && (
            <span className="tabular">{formatDistance(item.distanceMeters)} away</span>
          )}
          <span>{formatRelativeTime(item.createdAt)}</span>
        </div>

        {match.reasons.length > 0 && (
          <ul
            className="space-y-1 type-caption text-ink-muted"
            aria-label="Why it is recommended"
          >
            {match.reasons.slice(0, 3).map((reason) => (
              <li key={reason.code} className="flex items-start gap-1.5">
                <Check
                  className="mt-0.5 size-3 shrink-0 text-success"
                  aria-hidden="true"
                />
                {describeReason(reason, { perspective: 'organization' })}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
          <Button variant="secondary" size="sm" trailingIcon={<ArrowRight />} asChild>
            <Link href={`/problems/${item.publicId}`}>
              View problem<span className="sr-only">: {item.title}</span>
            </Link>
          </Button>
          {onDismiss && match.status !== 'DISMISSED' && (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<EyeOff />}
              loading={busy}
              onClick={onDismiss}
            >
              Not relevant<span className="sr-only"> to us: {item.title}</span>
            </Button>
          )}
          {onRestore && match.status === 'DISMISSED' && (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<RotateCcw />}
              loading={busy}
              onClick={onRestore}
            >
              Restore<span className="sr-only">: {item.title}</span>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
