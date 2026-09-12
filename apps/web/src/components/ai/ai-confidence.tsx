import { cn } from '@/lib/cn';
import { confidenceBand } from '@/lib/domain-display';
import { formatPercent } from '@/lib/format';

const BAND_BAR: Record<string, string> = {
  'High confidence': 'bg-ai',
  'Moderate confidence': 'bg-warning',
  'Low confidence': 'bg-danger',
};

export interface AiConfidenceProps {
  /** 0–1. */
  value: number;
  /** `bar` for insight cards, `inline` for dense rows. */
  variant?: 'bar' | 'inline';
  className?: string;
}

/**
 * AI confidence, shown as a meter plus a plain-language band.
 *
 * A bare "94%" invites false precision — it looks like a measurement when it is
 * an estimate. Pairing the number with "High confidence" tells the reader how
 * much weight to give the result, and the band is what changes colour, so the
 * meaning survives for anyone who cannot distinguish the hues.
 */
export function AiConfidence({ value, variant = 'bar', className }: AiConfidenceProps) {
  const band = confidenceBand(value);
  const percent = formatPercent(value);

  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        <span className="type-caption tabular font-medium text-ink">{percent}</span>
        <span className="type-caption text-ink-subtle">{band.label.toLowerCase()}</span>
      </span>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="type-caption text-ink-muted">Confidence</span>
        <span className="type-body-sm tabular font-semibold text-ink">{percent}</span>
      </div>

      <div
        role="meter"
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`AI confidence: ${band.label}`}
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-subtle"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-slow ease-out-quart',
            BAND_BAR[band.label] ?? 'bg-ai',
          )}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>

      <p className="mt-1.5 type-caption text-ink-subtle">{band.label}</p>
    </div>
  );
}
