import { ArrowRight, Copy, Gavel, NotebookPen, Send } from 'lucide-react';
import type { GovernmentActivityEntry, GovernmentAuditEntry } from '@samadhaan/shared';
import { ProblemStatusBadge } from '@/components/problems/problem-status-badge';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { describeActivity, describeActor } from '@/lib/government';

/**
 * Who did what, when — read from the audit log, which nobody can edit.
 * `showProblem` for the dashboard's area-wide feed; off on a problem's own
 * page, where the reference is redundant.
 */
export function AuditTimeline({
  entries,
  showProblem = true,
}: {
  entries: Array<GovernmentActivityEntry | GovernmentAuditEntry>;
  showProblem?: boolean;
}) {
  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const Icon =
          entry.kind === 'NOTE_ADDED'
            ? NotebookPen
            : entry.kind === 'DUPLICATE_CONFIRMED'
              ? Copy
              : entry.kind.startsWith('ALLOCATION_')
                ? Send
                : entry.kind.startsWith('PRIORITY_')
                  ? Gavel
                  : ArrowRight;
        const note = 'note' in entry ? entry.note : null;

        return (
          <li key={entry.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-subtle text-ink-subtle"
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="type-body-sm text-ink">
                {showProblem ? (
                  describeActivity(entry)
                ) : entry.kind === 'STATUS_CHANGED' &&
                  entry.fromStatus &&
                  entry.toStatus ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span className="sr-only">Status changed from</span>
                    <ProblemStatusBadge status={entry.fromStatus} size="sm" />
                    <ArrowRight className="size-3.5 text-ink-subtle" aria-hidden="true" />
                    <span className="sr-only">to</span>
                    <ProblemStatusBadge status={entry.toStatus} size="sm" />
                  </span>
                ) : entry.kind === 'NOTE_ADDED' ? (
                  'Internal note added'
                ) : entry.kind === 'DUPLICATE_CONFIRMED' ? (
                  'Confirmed as a duplicate'
                ) : (
                  describeActivity(entry)
                )}
              </p>
              {showProblem && (
                <p className="truncate type-caption text-ink-muted">
                  {entry.problemTitle}
                </p>
              )}
              {note && (
                <p className="mt-1 rounded-control bg-subtle/70 px-2.5 py-1.5 type-caption text-ink-muted">
                  {note}
                </p>
              )}
              <p className="mt-0.5 type-caption text-ink-subtle">
                {describeActor(entry)} ·{' '}
                <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
                  {formatRelativeTime(entry.createdAt)}
                </time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
