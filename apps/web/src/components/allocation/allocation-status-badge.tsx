import type { AllocationStatus } from '@samadhaan/shared';
import { Badge, StatusDot } from '@/components/ui/badge';
import { ALLOCATION_STATUS_DISPLAY } from '@/lib/allocation';

export function AllocationStatusBadge({
  status,
  size = 'md',
}: {
  status: AllocationStatus;
  size?: 'sm' | 'md';
}) {
  const display = ALLOCATION_STATUS_DISPLAY[status];
  return (
    <Badge tone={display.tone} size={size} icon={<StatusDot tone={display.tone} />}>
      {display.label}
    </Badge>
  );
}
