'use client';

import { Copy } from 'lucide-react';
import type { DuplicateCheckView } from '@samadhaan/shared';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';
import { useDuplicateCheck } from '@/hooks/use-duplicate-check';
import { AiBadge } from './ai-badge';
import { SimilarProblemCard } from './similar-problem-card';

/**
 * The "possible duplicate" section of the problem detail page.
 *
 * Seeded with whatever the server resolved, so a completed check renders on the
 * first paint. Polling only starts when one is still running.
 *
 * Renders nothing when a completed check found nothing. An empty "no duplicates
 * found" panel on every report would be noise on the overwhelming majority of
 * pages, where the only useful answer is silence.
 */
export function SimilarProblemsPanel({
  publicId,
  initial,
  canReview,
  className,
}: {
  publicId: string;
  initial: DuplicateCheckView | null;
  /** Mirrors the server's rule; the API enforces it regardless. */
  canReview: boolean;
  className?: string;
}) {
  const { check, loading, polling, error, confirm, reject, pendingCandidateId } =
    useDuplicateCheck(publicId, initial);

  if (loading && !check) {
    return <Skeleton className={cn('h-40', className)} />;
  }

  if (error) {
    return (
      <Alert tone="warning" title="Couldn’t check for similar problems" className={className}>
        {error} Your report is unaffected.
      </Alert>
    );
  }

  if (!check) return null;

  if (check.status === 'FAILED') {
    return (
      <Alert
        tone="info"
        title="Similar problems couldn’t be checked"
        className={className}
      >
        {/* Safe to show: written for a caller, never copied from a provider. */}
        {check.errorMessage ?? 'The matching service was unavailable.'} Your report has
        been saved and is unaffected.
      </Alert>
    );
  }

  if (polling) {
    return (
      <section
        aria-live="polite"
        aria-busy="true"
        className={cn('rounded-card border border-border bg-surface p-4', className)}
      >
        <div className="flex items-center gap-3">
          <Spinner className="size-4 text-ai" label={null} />
          <p className="type-body-sm text-ink-muted">
            Checking whether this has already been reported&hellip;
          </p>
        </div>
      </section>
    );
  }

  // Completed, nothing similar. Silence is the useful answer.
  if (check.candidates.length === 0) return null;

  const multiple = check.candidates.length > 1;

  return (
    <section
      className={cn(
        'overflow-hidden rounded-card border border-ai-border bg-ai-soft/40',
        className,
      )}
      aria-labelledby="similar-problems-heading"
    >
      <div className="flex items-center justify-between gap-3 border-b border-ai-border/60 px-4 py-2.5">
        <AiBadge label={multiple ? 'Possible existing problems' : 'Possible existing problem'} />
        <Copy className="size-3.5 text-ink-subtle" aria-hidden="true" />
      </div>

      <div className="space-y-3 bg-surface/70 p-4">
        <h2 id="similar-problems-heading" className="type-body-sm text-ink">
          {multiple
            ? 'These reports may already describe the same issue.'
            : 'This may already have been reported.'}
        </h2>

        {check.candidates.map((candidate) => (
          <SimilarProblemCard
            key={candidate.candidateId}
            candidate={candidate}
            canReview={canReview}
            pending={pendingCandidateId === candidate.candidateId}
            onConfirm={() => void confirm(candidate.candidateId)}
            onReject={() => void reject(candidate.candidateId)}
          />
        ))}

        <p className="border-t border-border-subtle pt-3 type-caption text-ink-subtle">
          {canReview
            ? 'Nothing is merged automatically. Your report stays exactly as you filed it unless you say it is the same issue.'
            : 'Nothing is merged automatically. Only the person who filed this report can confirm a match.'}
        </p>
      </div>
    </section>
  );
}
