import type {
  AllocationIneligibility,
  AllocationStatus,
  AllocationView,
} from '@samadhaan/shared';
import type { Tone } from '@/types/ui';

/**
 * Vocabulary for government allocation. Status is always a word in the badge,
 * never colour alone.
 */
export const ALLOCATION_STATUS_DISPLAY: Record<
  AllocationStatus,
  { label: string; tone: Tone }
> = {
  PENDING: { label: 'Awaiting response', tone: 'warning' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  DECLINED: { label: 'Declined', tone: 'danger' },
  CANCELLED: { label: 'Withdrawn', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
};

export const ALLOCATION_VIEW_LABEL: Record<AllocationView, string> = {
  pending: 'Awaiting response',
  active: 'Accepted',
  past: 'Closed',
  all: 'All',
};

export const INELIGIBILITY_LABEL: Record<AllocationIneligibility, string> = {
  NOT_VERIFIED: 'Not yet verified by Samadhaan',
  SUSPENDED: 'Suspended',
  REJECTED: 'Verification rejected',
  INACTIVE: 'Inactive',
};

/** Offered as starting points; the reason is always the member's own words. */
export const DECLINE_REASON_EXAMPLES = [
  'Outside our current capacity',
  'Outside our area of expertise',
  'Outside our service area',
  'Better suited to another organisation',
] as const;

export function allocationPath(slug: string, id?: string): string {
  const base = `/organization/${encodeURIComponent(slug)}/allocations`;
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}
