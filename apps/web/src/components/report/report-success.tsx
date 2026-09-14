'use client';

import { ArrowRight, CheckCircle2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ProblemView } from '@samadhaan/shared';
import { AnalysisFailed, ProblemIntelligence } from '@/components/ai/problem-intelligence';
import { AnalysisProcessing } from '@/components/ai/analysis-processing';
import { SimilarProblemsPanel } from '@/components/ai/similar-problems-panel';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { useAnalysisPolling } from '@/hooks/use-analysis-polling';

/**
 * Confirmation after a report is filed, then the analysis as it arrives.
 *
 * The copy is careful about what it claims. The problem has been *received* —
 * it has not been verified and nobody has assessed it. Saying otherwise would
 * be the easiest and most damaging lie the product could tell a citizen who
 * just reported something dangerous.
 */
export function ReportSuccess({ problem }: { problem: ProblemView }) {
  const { analysis, polling, retry, retrying } = useAnalysisPolling(problem.publicId);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Drives the indicative stage list. Stops as soon as the analysis settles,
  // so a finished analysis does not leave a timer running.
  useEffect(() => {
    if (!polling) return;

    const started = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - started), 400);

    return () => clearInterval(timer);
  }, [polling]);

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Card>
        <CardBody className="px-6 py-10 text-center sm:px-10">
          <span
            aria-hidden="true"
            className="mx-auto grid size-12 place-items-center rounded-full bg-success-soft text-success"
          >
            <CheckCircle2 className="size-6" />
          </span>

          <h1 className="mt-5 type-h2 text-ink">Your problem has been reported.</h1>

          <p className="mt-4 type-caption text-ink-muted">Reference</p>
          <p className="mt-1 font-mono type-h3 tabular text-ink">{problem.publicId}</p>

          <p className="mt-5 type-body text-ink-muted">
            Samadhaan will review your report and help route it to the right people.
            You can follow its progress at any time using the reference above.
          </p>
        </CardBody>
      </Card>

      {/* Surfaced above the analysis: "you may be reporting something already
          filed" is the more consequential thing to tell someone who has just
          submitted, and it is the only part of this screen they can act on.
          The report is already saved either way — this never blocks it. */}
      <SimilarProblemsPanel
        publicId={problem.publicId}
        initial={null}
        // The reporter is on this screen by definition.
        canReview
      />

      {polling && <AnalysisProcessing elapsedMs={elapsedMs} />}

      {analysis?.status === 'COMPLETED' && <ProblemIntelligence analysis={analysis} />}

      {analysis?.status === 'FAILED' && (
        <AnalysisFailed
          message={analysis.errorMessage}
          onRetry={() => void retry()}
          retrying={retrying}
          // The reporter is on this screen by definition.
          canRetry
        />
      )}

      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:justify-center">
        <Button variant="primary" trailingIcon={<ArrowRight />} asChild>
          <Link href={`/problems/${problem.publicId}`}>View problem</Link>
        </Button>

        <Button variant="secondary" leadingIcon={<Plus />} asChild>
          <Link href="/report">Report another</Link>
        </Button>
      </div>

      <div className="text-center">
        <Button variant="link" size="sm" asChild>
          <Link href="/dashboard">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
