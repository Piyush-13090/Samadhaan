import { PROBLEM_STATUS_DISPLAY } from '@/lib/domain-display';
import type { ProblemStatus } from '@/types/domain';
import { Badge, StatusDot } from '@/components/ui/badge';

/** Where a problem sits in its lifecycle. Dot + label, never colour alone. */
export function ProblemStatusBadge({
  status,
  size = 'md',
  className,
}: {
  status: ProblemStatus;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const display = PROBLEM_STATUS_DISPLAY[status];

  return (
    <Badge
      tone={display.tone}
      size={size}
      className={className}
      icon={<StatusDot tone={display.tone} />}
    >
      {display.label}
    </Badge>
  );
}
