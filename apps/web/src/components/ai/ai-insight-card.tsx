import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CATEGORY_DISPLAY, SEVERITY_DISPLAY } from '@/lib/domain-display';
import type { AiAnalysis } from '@/types/domain';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { AiBadge } from './ai-badge';
import { AiConfidence } from './ai-confidence';

/**
 * Presents an AI analysis.
 *
 * The visual language is deliberately restrained: a tinted teal surface, a
 * hairline border and one small mark. It should read as a capability of the
 * product, not as a gimmick — so no glow, no animated gradient, no robot.
 *
 * Findings are always shown with their confidence, and the footnote states
 * plainly that a person has the final say. That is a product commitment, not
 * decoration: AI recommends, humans decide.
 */
export function AiInsightCard({
  analysis,
  className,
  footer,
}: {
  analysis: AiAnalysis;
  className?: string;
  footer?: ReactNode;
}) {
  const severity = SEVERITY_DISPLAY[analysis.severity];

  return (
    <section
      className={cn(
        'overflow-hidden rounded-card border border-ai-border bg-ai-soft/50',
        className,
      )}
      aria-label="Samadhaan AI analysis"
    >
      <div className="flex items-center justify-between gap-3 border-b border-ai-border/60 px-4 py-2.5">
        <AiBadge />
        {analysis.duplicateCandidates ? (
          <span className="type-caption text-ink-muted">
            {analysis.duplicateCandidates} possible duplicate
            {analysis.duplicateCandidates === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <div className="space-y-4 bg-surface/70 px-4 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="type-caption text-ink-muted">Category</p>
            <p className="mt-1 type-body-sm font-semibold text-ink">
              {CATEGORY_DISPLAY[analysis.category].label}
            </p>
          </div>

          <div>
            <p className="type-caption text-ink-muted">Severity</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="type-body-sm tabular font-semibold text-ink">
                {analysis.severityScore.toFixed(1)}
                <span className="type-caption font-normal text-ink-subtle"> / 10</span>
              </span>
              <SeverityBadge severity={analysis.severity} size="sm" />
            </div>
            <span className="sr-only">{severity.label} severity</span>
          </div>
        </div>

        <AiConfidence value={analysis.confidence} />

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

        <p className="border-t border-border-subtle pt-3 type-caption text-ink-subtle">
          Samadhaan AI produced this analysis. A reviewer confirms it before any decision
          is made.
        </p>

        {footer}
      </div>
    </section>
  );
}
