import { MapPin, MessageSquare, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { formatCompactNumber, formatDistance, formatRelativeTime } from '@/lib/format';
import type { ProblemSummary } from '@/types/domain';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { AvatarGroup } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { CategoryBadge } from './category-badge';
import { ProblemStatusBadge } from './problem-status-badge';
import { SeverityBadge } from './severity-badge';

/**
 * The feed unit — the component a citizen will see more than any other.
 *
 * Reading order is deliberate: reference and status first (is this mine, what
 * is happening), then the title, then where and when, then the community
 * signal. Severity sits with the status row because together they answer
 * "should I care about this one".
 *
 * The whole card is a link via an overlay on the title, so the hit target is
 * the full card while the accessible name stays the title alone — nesting the
 * badges and counts inside an anchor would make the announced link name
 * unreadable.
 */
export function ProblemCard({
  problem,
  href,
  compact = false,
  className,
}: {
  problem: ProblemSummary;
  href?: string;
  /** Drops the description and community row, for sidebars and dense lists. */
  compact?: boolean;
  className?: string;
}) {
  const target = href ?? `/problems/${problem.reference}`;

  return (
    <Card
      as="article"
      interactive
      className={cn('group relative flex flex-col', className)}
    >
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono type-caption text-ink-subtle">
            {problem.reference}
          </span>
          <ProblemStatusBadge status={problem.status} size="sm" />
          <SeverityBadge severity={problem.severity} size="sm" />
          {problem.ai && (
            <span
              title="Analysed by Samadhaan AI"
              className="ml-auto inline-flex items-center text-ai"
            >
              <AiSparkIcon className="size-3.5" />
              <span className="sr-only">Analysed by Samadhaan AI</span>
            </span>
          )}
        </div>

        <h3 className="mt-2.5 type-h4 text-ink">
          <Link href={target} className="outline-none before:absolute before:inset-0">
            {problem.title}
          </Link>
        </h3>

        {!compact && (
          <p className="mt-1.5 line-clamp-2 type-body-sm text-ink-muted">
            {problem.description}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-ink-subtle">
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {problem.location.area ?? problem.location.address}
            </span>
          </span>
          {problem.location.distanceMeters !== undefined && (
            <span>{formatDistance(problem.location.distanceMeters)} away</span>
          )}
          <span>{formatRelativeTime(problem.reportedAt)}</span>
        </div>

        {problem.progress !== undefined && problem.progress > 0 && (
          <ProgressBar
            value={problem.progress}
            tone={problem.progress === 100 ? 'success' : 'primary'}
            size="sm"
            label={`Resolution progress for ${problem.reference}`}
            className="mt-3.5"
          />
        )}

        {!compact && <div className="flex-1" />}
      </div>

      {!compact && (
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-2.5">
          <div className="flex items-center gap-3 type-caption text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="size-3.5" aria-hidden="true" />
              <span className="tabular">
                {formatCompactNumber(problem.supporterCount)}
              </span>
              <span className="sr-only">supporters</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3.5" aria-hidden="true" />
              <span className="tabular">{problem.commentCount}</span>
              <span className="sr-only">comments</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <CategoryBadge category={problem.category} short size="sm" />
            {problem.assignedTo?.length ? (
              <AvatarGroup
                size="xs"
                max={3}
                people={problem.assignedTo.map((org) => ({
                  id: org.id,
                  name: org.name,
                  avatarUrl: org.logoUrl,
                }))}
              />
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}
