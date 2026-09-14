import { MapPin, MessageSquare, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import type { ProblemListItem } from '@samadhaan/shared';
import { cn } from '@/lib/cn';
import { formatCompactNumber, formatDistance, formatRelativeTime } from '@/lib/format';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { Card } from '@/components/ui/card';
import { CategoryBadge } from './category-badge';
import { ProblemStatusBadge } from './problem-status-badge';
import { SeverityBadge } from './severity-badge';

/**
 * A problem in a feed, rendered from the API's list shape.
 *
 * Distinct from `ProblemCard`, which renders the richer `ProblemSummary` view
 * model. This one takes exactly what `/problems/nearby` and `/problems/my`
 * return — no reporter, no internal id, no coordinates — so a card physically
 * cannot display a field the API declined to send.
 *
 * The whole card is a link via an overlay on the title, so the hit target is
 * the full card while the accessible name stays the title alone.
 */
export function ProblemListCard({
  problem,
  showDistance = true,
  className,
}: {
  problem: ProblemListItem;
  /** Hidden on "your reports", where distance from yourself means nothing. */
  showDistance?: boolean;
  className?: string;
}) {
  const locality = problem.area ?? problem.city;

  return (
    <Card as="article" interactive className={cn('group relative flex flex-col', className)}>
      <div className="flex flex-1 gap-3 p-4">
        {problem.thumbnailUrl && (
          /* eslint-disable-next-line @next/next/no-img-element --
             media is served from a storage-backed route, not the app's image
             pipeline; next/image would proxy it needlessly.
             Decorative: the title carries the meaning. */
          <img
            src={problem.thumbnailUrl}
            alt=""
            loading="lazy"
            className="size-16 shrink-0 rounded-control bg-subtle object-cover"
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono type-caption text-ink-subtle">
              {problem.publicId}
            </span>
            <ProblemStatusBadge status={problem.status} size="sm" />
            <SeverityBadge severity={problem.severity} size="sm" />
            {problem.hasAiAnalysis && (
              <span title="Analysed by Samadhaan AI" className="ml-auto text-ai">
                <AiSparkIcon className="size-3.5" />
                <span className="sr-only">Analysed by Samadhaan AI</span>
              </span>
            )}
          </div>

          <h3 className="mt-2 type-body-sm font-semibold text-ink">
            <Link
              href={`/problems/${problem.publicId}`}
              className="outline-none before:absolute before:inset-0"
            >
              {problem.title}
            </Link>
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-ink-subtle">
            {locality && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{locality}</span>
              </span>
            )}
            {showDistance && problem.distanceMeters !== null && (
              <span className="tabular">
                {formatDistance(problem.distanceMeters)} away
              </span>
            )}
            <span>{formatRelativeTime(problem.createdAt)}</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <CategoryBadge category={problem.category} short size="sm" />

            <div className="flex items-center gap-3 type-caption text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <TrendingUp className="size-3.5" aria-hidden="true" />
                <span className="tabular">{formatCompactNumber(problem.voteCount)}</span>
                <span className="sr-only">people also affected</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3.5" aria-hidden="true" />
                <span className="tabular">{problem.commentCount}</span>
                <span className="sr-only">comments</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Matching skeleton, so a loading feed occupies the space it will fill. */
export function ProblemListCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-card border border-border bg-surface p-4', className)}
      aria-hidden="true"
    >
      <div className="flex gap-3">
        <div className="size-16 shrink-0 animate-shimmer rounded-control bg-subtle" />
        <div className="flex-1 space-y-2.5">
          <div className="h-3 w-24 animate-shimmer rounded bg-subtle" />
          <div className="h-4 w-4/5 animate-shimmer rounded bg-subtle" />
          <div className="h-3 w-2/3 animate-shimmer rounded bg-subtle" />
        </div>
      </div>
    </div>
  );
}
