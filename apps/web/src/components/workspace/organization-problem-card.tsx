import { Check } from 'lucide-react';
import type { OrganizationProblemItem } from '@samadhaan/shared';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { ProblemListCard } from '@/components/problems/problem-list-card';
import { CATEGORY_DISPLAY, SEVERITY_DISPLAY } from '@/lib/domain-display';
import { EXPERTISE_DISPLAY } from '@/lib/profile-display';
import { RELEVANCE_REASON_LABEL } from '@/lib/workspace';

/**
 * A problem as an organisation sees it: the standard feed card, plus why it is
 * listed and what the AI analysis classified it as.
 *
 * "Why it is listed" is a set of plain facts about the organisation's own
 * profile — an area of work, the service area — never a score. The AI line is
 * the stored classification and its confidence; the analysis' raw output never
 * reaches the browser.
 */
export function OrganizationProblemCard({
  problem,
  className,
}: {
  problem: OrganizationProblemItem;
  className?: string;
}) {
  const { reasons, expertiseLevel } = problem.relevance;
  const ai = problem.ai;

  const footer =
    reasons.length > 0 || ai ? (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 type-caption">
        {reasons.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ink-muted">
            <span className="sr-only">Listed because: </span>
            {reasons.map((reason) => (
              <span key={reason} className="inline-flex items-center gap-1">
                <Check className="size-3 text-success" aria-hidden="true" />
                {RELEVANCE_REASON_LABEL[reason]}
                {reason === 'EXPERTISE_MATCH' && expertiseLevel && (
                  <span className="text-ink-subtle">
                    ({EXPERTISE_DISPLAY[expertiseLevel].label.toLowerCase()})
                  </span>
                )}
              </span>
            ))}
          </p>
        )}

        {ai && ai.category && (
          <p className="inline-flex min-w-0 items-center gap-1.5 text-ink-muted">
            <AiSparkIcon className="size-3.5 shrink-0 text-ai" />
            <span className="sr-only">AI classification: </span>
            <span className="truncate">
              {CATEGORY_DISPLAY[ai.category].label}
              {ai.subcategory && ` → ${ai.subcategory}`}
              {ai.severity && ` · ${SEVERITY_DISPLAY[ai.severity].label}`}
            </span>
            {ai.confidence !== null && (
              <span className="shrink-0 tabular text-ink-subtle">
                {Math.round(ai.confidence * 100)}% confidence
              </span>
            )}
          </p>
        )}
      </div>
    ) : undefined;

  return <ProblemListCard problem={problem} footer={footer} className={className} />;
}
