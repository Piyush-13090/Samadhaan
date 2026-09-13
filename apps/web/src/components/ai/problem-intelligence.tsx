'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { confidenceBand, type ProblemAnalysisView } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import { formatPercent } from '@/lib/format';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { AiBadge } from './ai-badge';

const BAND_BAR: Record<string, string> = {
  success: 'bg-ai',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/**
 * A completed AI analysis.
 *
 * Every finding is shown with its confidence, and the footnote states plainly
 * that a reviewer decides. That is a product commitment, not decoration: a
 * severity score attached to a real civic problem must never read as a verdict.
 *
 * When the analysis came from the development stub, it says so — a placeholder
 * presented as AI output would be the most damaging thing on this page.
 */
export function ProblemIntelligence({
  analysis,
  className,
}: {
  analysis: ProblemAnalysisView;
  className?: string;
}) {
  const confidence = analysis.confidence ?? 0;
  const band = confidenceBand(confidence);
  const isDevelopmentStub = analysis.modelName.startsWith('development');

  return (
    <section
      className={cn('overflow-hidden rounded-card border border-ai-border bg-ai-soft/50', className)}
      aria-labelledby="ai-intelligence-heading"
    >
      <div className="flex items-center justify-between gap-3 border-b border-ai-border/60 px-4 py-2.5">
        <AiBadge label="AI problem intelligence" />
        {analysis.textOnly && (
          <span className="type-caption text-ink-muted">From description only</span>
        )}
      </div>

      <div className="space-y-5 bg-surface/70 px-4 py-4">
        <h2 id="ai-intelligence-heading" className="sr-only">
          AI problem intelligence
        </h2>

        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="type-caption text-ink-muted">Category</dt>
            <dd className="mt-1 type-body-sm font-semibold text-ink">
              {analysis.category ? CATEGORY_DISPLAY[analysis.category].label : '—'}
            </dd>
          </div>

          <div>
            <dt className="type-caption text-ink-muted">Issue</dt>
            <dd className="mt-1 type-body-sm font-semibold text-ink">
              {analysis.subcategory ?? '—'}
            </dd>
          </div>

          <div>
            <dt className="type-caption text-ink-muted">Severity</dt>
            <dd className="mt-1 flex items-center gap-2">
              {analysis.severity ? (
                <>
                  <SeverityBadge severity={analysis.severity} size="sm" />
                  {analysis.severityScore !== null && (
                    <span className="tabular type-caption text-ink-subtle">
                      {analysis.severityScore.toFixed(1)} / 10
                    </span>
                  )}
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>

          <div>
            <dt className="type-caption text-ink-muted">Urgency</dt>
            <dd className="mt-1 type-body-sm font-semibold text-ink">
              {analysis.urgency ?? '—'}
            </dd>
          </div>
        </dl>

        {/* Confidence: a number and a plain-language band. The number alone
            invites false precision — it reads like a measurement. */}
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="type-caption text-ink-muted">AI confidence</span>
            <span className="type-body-sm tabular font-semibold text-ink">
              {formatPercent(confidence)}
            </span>
          </div>

          <div
            role="meter"
            aria-valuenow={Math.round(confidence * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`AI confidence: ${band.label}`}
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-subtle"
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-slow ease-out-quart',
                BAND_BAR[band.tone] ?? 'bg-ai',
              )}
              style={{ width: `${Math.round(confidence * 100)}%` }}
            />
          </div>

          <p className="mt-1.5 type-caption text-ink-subtle">{band.label}</p>
        </div>

        {analysis.summary && (
          <div>
            <p className="type-caption text-ink-muted">Summary</p>
            <p className="mt-1 type-body-sm text-ink">{analysis.summary}</p>
          </div>
        )}

        {analysis.observations.length > 0 && (
          <div>
            <p className="type-caption text-ink-muted">What the AI observed</p>
            <ul className="mt-2 space-y-1.5">
              {analysis.observations.map((observation) => (
                <li key={observation} className="flex gap-2 type-body-sm text-ink">
                  <span
                    aria-hidden="true"
                    className="mt-1.75 size-1 shrink-0 rounded-full bg-ai"
                  />
                  {observation}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isDevelopmentStub && (
          <p className="flex items-start gap-2 rounded-control border border-warning-border bg-warning-soft px-3 py-2 type-caption text-ink">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
            This analysis came from a development placeholder, not an AI model.
          </p>
        )}

        <p className="border-t border-border-subtle pt-3 type-caption text-ink-subtle">
          Samadhaan AI produced this analysis. A reviewer confirms it before any
          decision is made.
        </p>
      </div>
    </section>
  );
}

/** Shown when an analysis could not be completed. */
export function AnalysisFailed({
  message,
  onRetry,
  retrying = false,
  canRetry = false,
  className,
}: {
  message: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  /** Only the reporter and admins may retry; the API enforces it regardless. */
  canRetry?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-card border border-border bg-surface p-5', className)}
      role="status"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-warning-soft text-warning"
        >
          <AlertTriangle className="size-4.5" />
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="type-h4 text-ink">
            AI analysis couldn&rsquo;t be completed right now
          </h3>
          <p className="mt-1 type-body-sm text-ink-muted">
            {/* Safe to show: these messages are written for a caller, never
                copied from a provider's own error text. */}
            {message ?? 'The analysis service was unavailable.'} Your report has been
            saved and is unaffected.
          </p>

          {canRetry && onRetry && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              leadingIcon={<RotateCw />}
              loading={retrying}
              onClick={onRetry}
            >
              Try analysis again
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
