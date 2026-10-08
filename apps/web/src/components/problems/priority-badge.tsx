import { Gavel } from 'lucide-react';
import type { PriorityTier } from '@samadhaan/shared';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { PRIORITY_TIER_DISPLAY } from '@/lib/domain-display';

/**
 * An advisory priority tier (Prompt 21). `overridden` marks a tier an official
 * set, so an AI estimate and a government decision never look the same;
 * `provisional` marks a low-confidence or low-completeness assessment.
 */
export function PriorityBadge({
  tier,
  overridden = false,
  provisional = false,
  size = 'md',
  className,
}: {
  tier: PriorityTier | null;
  overridden?: boolean;
  provisional?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  if (!tier) {
    return (
      <Badge tone="neutral" size={size} className={className}>
        Priority not assessed
      </Badge>
    );
  }
  const display = PRIORITY_TIER_DISPLAY[tier];
  const description = overridden
    ? `${display.label} — set by a government official`
    : `${display.label} — AI-assisted estimate${provisional ? ', provisional' : ''}. ${display.description}`;
  return (
    <Tooltip content={description}>
      <span className="inline-flex">
        <Badge
          tone={display.tone}
          size={size}
          className={className}
          icon={
            overridden ? <Gavel aria-hidden="true" /> : <StatusDot tone={display.tone} />
          }
        >
          {display.label} priority{provisional && !overridden ? ' (provisional)' : ''}
          <span className="sr-only"> — {description}</span>
        </Badge>
      </span>
    </Tooltip>
  );
}
