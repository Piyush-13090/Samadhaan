import { Building2, CheckCircle2, Send, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import type { AllocationStatus } from '@samadhaan/shared';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelativeTime } from '@/lib/format';

/** The facts a timeline is drawn from — both portals can supply them. */
export interface TimelineAllocation {
  id: string;
  status: AllocationStatus;
  organizationName: string;
  proposedAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  cancelledAt: string | null;
}

type EventKind =
  'VERIFIED' | 'ALLOCATED' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'IN_PROGRESS';

interface TimelineEvent {
  key: string;
  kind: EventKind;
  label: string;
  at: string;
}

const ICON: Record<EventKind, typeof Send> = {
  VERIFIED: ShieldCheck,
  ALLOCATED: Send,
  ACCEPTED: CheckCircle2,
  DECLINED: XCircle,
  CANCELLED: Undo2,
  IN_PROGRESS: Building2,
};

const TONE: Record<EventKind, string> = {
  VERIFIED: 'bg-info-soft text-info',
  ALLOCATED: 'bg-primary-soft text-primary',
  ACCEPTED: 'bg-success-soft text-success',
  DECLINED: 'bg-warning-soft text-warning',
  CANCELLED: 'bg-subtle text-ink-subtle',
  IN_PROGRESS: 'bg-success-soft text-success',
};

/**
 * Verified → allocated → accepted/declined/withdrawn → in progress, oldest
 * first, with reallocations in sequence. Built only from recorded
 * timestamps; nothing is inferred.
 */
export function allocationTimelineEvents(
  allocations: readonly TimelineAllocation[],
  verifiedAt: string | null,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  if (verifiedAt) {
    events.push({ key: 'verified', kind: 'VERIFIED', label: 'Verified', at: verifiedAt });
  }
  for (const allocation of allocations) {
    const org = allocation.organizationName;
    events.push({
      key: `${allocation.id}-allocated`,
      kind: 'ALLOCATED',
      label: `Allocated to ${org}`,
      at: allocation.proposedAt,
    });
    if (allocation.acceptedAt) {
      events.push({
        key: `${allocation.id}-accepted`,
        kind: 'ACCEPTED',
        label: `Accepted by ${org}`,
        at: allocation.acceptedAt,
      });
      events.push({
        key: `${allocation.id}-in-progress`,
        kind: 'IN_PROGRESS',
        label: 'In progress',
        at: allocation.acceptedAt,
      });
    }
    if (allocation.declinedAt) {
      events.push({
        key: `${allocation.id}-declined`,
        kind: 'DECLINED',
        label: `Declined by ${org}`,
        at: allocation.declinedAt,
      });
    }
    if (allocation.cancelledAt) {
      events.push({
        key: `${allocation.id}-cancelled`,
        kind: 'CANCELLED',
        label: `Allocation to ${org} withdrawn`,
        at: allocation.cancelledAt,
      });
    }
  }
  // Stable: events at the same instant keep their causal order above.
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.at.localeCompare(b.event.at) || a.index - b.index)
    .map(({ event }) => event);
}

export function AllocationTimeline({
  allocations,
  verifiedAt,
  className,
}: {
  allocations: readonly TimelineAllocation[];
  verifiedAt: string | null;
  className?: string;
}) {
  const events = allocationTimelineEvents(allocations, verifiedAt);
  if (events.length === 0) return null;

  return (
    <ol aria-label="Allocation timeline" className={cn('space-y-3', className)}>
      {events.map((event) => {
        const Icon = ICON[event.kind];
        return (
          <li key={event.key} className="flex gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full',
                TONE[event.kind],
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="type-body-sm text-ink">{event.label}</p>
              <p className="type-caption text-ink-subtle">
                <time dateTime={event.at} title={formatDateTime(event.at)}>
                  {formatRelativeTime(event.at)}
                </time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
