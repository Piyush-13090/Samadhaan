import { AlertTriangle, BadgeCheck, Clock, XCircle } from 'lucide-react';
import type { VerificationStatus } from '@samadhaan/shared';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { VERIFICATION_DISPLAY } from '@/lib/profile-display';

const ICONS = {
  VERIFIED: BadgeCheck,
  PENDING: Clock,
  REJECTED: XCircle,
  SUSPENDED: AlertTriangle,
} as const;

/**
 * An organisation's verification state.
 *
 * Icon plus label, never colour alone — verification is the single most
 * consequential signal on the page, and a citizen deciding whether to trust an
 * organisation must not depend on distinguishing green from amber.
 */
export function VerificationBadge({
  status,
  size = 'md',
}: {
  status: VerificationStatus;
  size?: 'sm' | 'md';
}) {
  const display = VERIFICATION_DISPLAY[status];
  const Icon = ICONS[status];

  return (
    <Tooltip content={display.description}>
      <span className="inline-flex">
        <Badge tone={display.tone} size={size} icon={<Icon className="size-3" />}>
          {display.label}
        </Badge>
      </span>
    </Tooltip>
  );
}
