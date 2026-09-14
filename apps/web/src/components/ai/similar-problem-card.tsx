'use client';

import Link from 'next/link';
import { ArrowRight, Check, MapPin, X } from 'lucide-react';
import {
  duplicateVerdictLabel,
  formatDistance,
  type SimilarProblemView,
} from '@samadhaan/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { CATEGORY_DISPLAY, PROBLEM_STATUS_DISPLAY } from '@/lib/domain-display';
import { formatPercent } from '@/lib/format';

/**
 * One problem that may already describe the same issue.
 *
 * The wording never asserts. "Likely the same problem" and "Possibly the same
 * problem" are claims with a stated strength; "this is a duplicate" would be a
 * verdict the system is not entitled to reach. Only the person who filed the
 * report can settle it, which is what the two actions are for.
 */
export function SimilarProblemCard({
  candidate,
  canReview,
  onConfirm,
  onReject,
  pending = false,
  className,
}: {
  candidate: SimilarProblemView;
  /** Mirrors the server's rule; the API enforces it regardless. */
  canReview: boolean;
  onConfirm?: () => void;
  onReject?: () => void;
  pending?: boolean;
  className?: string;
}) {
  const verdict = duplicateVerdictLabel(candidate.verdict);
  const status = PROBLEM_STATUS_DISPLAY[candidate.problem.status];
  const distance = formatDistance(candidate.distanceMeters);

  return (
    <article
      className={cn(
        'rounded-card border bg-surface p-4',
        verdict.tone === 'warning' ? 'border-warning-border' : 'border-border',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <Badge tone={verdict.tone} size="sm">
          {verdict.title}
        </Badge>
        <span className="tabular type-caption text-ink-muted">
          {formatPercent(candidate.similarity)} similar
        </span>
      </div>

      <div className="mt-3 flex gap-3">
        {candidate.problem.thumbnailUrl && (
          /* eslint-disable-next-line @next/next/no-img-element --
             media is served from a storage-backed route, not the app's image
             pipeline; next/image would proxy it needlessly.
             Decorative: the title carries the meaning, and describing a photo
             of somebody else's report is not something this page can do well. */
          <img
            src={candidate.problem.thumbnailUrl}
            alt=""
            className="size-14 shrink-0 rounded-control object-cover"
          />
        )}

        <div className="min-w-0 flex-1">
          <p className="type-caption tabular text-ink-subtle">
            {candidate.problem.publicId}
          </p>
          <h3 className="mt-0.5 type-body-sm font-semibold text-ink">
            {candidate.problem.title}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-ink-muted">
            <span>{CATEGORY_DISPLAY[candidate.problem.category].label}</span>
            <span className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 rounded-full',
                  status.tone === 'success' ? 'bg-success' : 'bg-info',
                )}
              />
              {status.label}
            </span>
            {distance && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3" aria-hidden="true" />
                {distance}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Evidence, not reasoning: each line is a fact the reader can check
          against the linked report. */}
      {candidate.evidence.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {candidate.evidence.map((entry) => (
            <li
              key={entry.id}
              className="rounded-full bg-subtle px-2 py-0.5 type-caption text-ink-muted"
            >
              {entry.label}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          asChild
          trailingIcon={<ArrowRight />}
        >
          <Link href={`/problems/${candidate.problem.publicId}`}>View problem</Link>
        </Button>

        {canReview && onConfirm && onReject && (
          <>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Check />}
              onClick={onConfirm}
              disabled={pending}
            >
              Same issue
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<X />}
              onClick={onReject}
              disabled={pending}
            >
              Different issue
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
