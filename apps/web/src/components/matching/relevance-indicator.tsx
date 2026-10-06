import { cn } from '@/lib/cn';
import { RELEVANCE_BAND_LABEL, formatRelevance, relevanceBand } from '@/lib/matching';

/**
 * A relevance score, written out — "92% relevance · High relevance" — with a
 * thin bar as a visual aid only. Never labelled confidence: it is a weighted
 * relevance score, not a calibrated probability.
 */
export function RelevanceIndicator({
  relevance,
  className,
}: {
  relevance: number;
  className?: string;
}) {
  const band = relevanceBand(relevance);

  return (
    <div className={cn('min-w-0', className)}>
      <p className="flex items-baseline gap-2">
        <span className="tabular type-body font-semibold text-ink">
          {formatRelevance(relevance)}
        </span>
        <span className="type-caption text-ink-subtle">{RELEVANCE_BAND_LABEL[band]}</span>
      </p>
      <div aria-hidden="true" className="mt-1.5 h-1 w-28 rounded-full bg-subtle">
        <div
          className={cn(
            'h-full rounded-full',
            band === 'high'
              ? 'bg-primary'
              : band === 'moderate'
                ? 'bg-info'
                : 'bg-ink-subtle',
          )}
          style={{ width: `${Math.round(relevance * 100)}%` }}
        />
      </div>
    </div>
  );
}
