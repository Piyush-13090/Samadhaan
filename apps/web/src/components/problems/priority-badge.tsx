import { PRIORITY_DISPLAY } from '@/lib/domain-display';
import type { PriorityLevel } from '@/types/domain';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * Triage priority for the government workspace.
 *
 * The code (P1–P4) is terse by design — it appears in dense queues — so the
 * meaning is carried in a tooltip and in screen-reader text rather than being
 * left implicit.
 */
export function PriorityBadge({
  priority,
  size = 'md',
  className,
}: {
  priority: PriorityLevel;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const display = PRIORITY_DISPLAY[priority];

  return (
    <Tooltip content={display.description}>
      <span className="inline-flex">
        <Badge tone={display.tone} size={size} className={cnPriority(className)}>
          {display.label}
          <span className="sr-only"> — {display.description}</span>
        </Badge>
      </span>
    </Tooltip>
  );
}

/** Priority codes are numeric-adjacent; tabular figures keep queues aligned. */
function cnPriority(className?: string): string {
  return ['tabular', className].filter(Boolean).join(' ');
}
