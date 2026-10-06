import type { ProjectActivityEntry } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { TIMELINE_KINDS, describeProjectActivity } from '@/lib/project';

/** Recent activity, newest first — structured events, never chat text. */
export function ProjectActivity({
  entries,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  entries: ProjectActivityEntry[] | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (entries === null)
    return <p className="type-body-sm text-ink-muted">Loading activity…</p>;
  if (entries.length === 0)
    return <p className="type-body-sm text-ink-muted">No activity yet.</p>;
  return (
    <div className="space-y-3">
      <ol className="space-y-3" aria-label="Recent project activity">
        {entries.map((entry) => (
          <li key={entry.id}>
            <p className="type-body-sm text-ink">{describeProjectActivity(entry)}</p>
            {entry.kind === 'PROJECT_STATUS_CHANGED' && entry.detail && (
              <p className="type-caption text-ink-muted">Reason: {entry.detail}</p>
            )}
            <p className="type-caption text-ink-subtle">
              <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
                {formatRelativeTime(entry.createdAt)}
              </time>
            </p>
          </li>
        ))}
      </ol>
      {hasMore && (
        <Button variant="ghost" size="sm" loading={loadingMore} onClick={onLoadMore}>
          Show earlier activity
        </Button>
      )}
    </div>
  );
}

/** The project's key moments, oldest first. */
export function ProjectTimeline({ entries }: { entries: ProjectActivityEntry[] | null }) {
  const moments = (entries ?? [])
    .filter((entry) => TIMELINE_KINDS.includes(entry.kind))
    .reverse();
  if (moments.length === 0)
    return <p className="type-body-sm text-ink-muted">Nothing yet.</p>;
  return (
    <ol
      className="relative space-y-4 border-l border-border pl-5"
      aria-label="Project timeline"
    >
      {moments.map((entry) => (
        <li key={entry.id} className="relative">
          <span
            aria-hidden="true"
            className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-primary"
          />
          <p className="type-body-sm text-ink">{describeProjectActivity(entry)}</p>
          <p className="type-caption text-ink-subtle">
            <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
          </p>
        </li>
      ))}
    </ol>
  );
}
