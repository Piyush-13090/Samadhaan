'use client';

import type { ProblemAnalysisView } from '@samadhaan/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalysisPolling } from '@/hooks/use-analysis-polling';
import { AnalysisProcessing } from './analysis-processing';
import { AnalysisFailed, ProblemIntelligence } from './problem-intelligence';
import { useEffect, useState } from 'react';

/**
 * The AI section of the problem detail page.
 *
 * Seeded with whatever the server resolved, so a completed analysis renders on
 * the first paint with no flash of loading. Polling only starts when the
 * analysis is still in flight.
 */
export function ProblemIntelligencePanel({
  publicId,
  initial,
  canRetry,
}: {
  publicId: string;
  initial: ProblemAnalysisView | null;
  /** Mirrors the server's rule; the API enforces it regardless. */
  canRetry: boolean;
}) {
  const { analysis, loading, polling, retry, retrying } = useAnalysisPolling(
    publicId,
    initial,
  );
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!polling) return;

    const started = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - started), 400);

    return () => clearInterval(timer);
  }, [polling]);

  if (loading && !analysis) {
    return <Skeleton className="h-64" />;
  }

  // No analysis has ever been queued for this problem — reports filed before
  // this milestone are the realistic case.
  if (!analysis) return null;

  if (analysis.status === 'COMPLETED') {
    return <ProblemIntelligence analysis={analysis} />;
  }

  if (analysis.status === 'FAILED') {
    return (
      <AnalysisFailed
        message={analysis.errorMessage}
        onRetry={() => void retry()}
        retrying={retrying}
        canRetry={canRetry}
      />
    );
  }

  return <AnalysisProcessing elapsedMs={elapsedMs} />;
}
