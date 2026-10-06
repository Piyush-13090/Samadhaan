import type { SourceReference } from '@samadhaan/shared';

const KIND_LABEL: Record<SourceReference['kind'], string> = {
  task: 'Task',
  milestone: 'Milestone',
  message: 'Message',
  event: 'Activity',
  update: 'Update',
  question: 'Question',
  signal: 'Signal',
  knowledge: 'Guidance',
};

/** What a finding rests on — every AI claim links back to real project data. */
export function SourceLinks({ sources }: { sources: SourceReference[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 type-caption text-ink-subtle">
      <span>Source:</span>
      {sources.map((source) =>
        source.href ? (
          <a
            key={`${source.kind}:${source.id}`}
            href={source.href}
            className="text-primary underline-offset-2 hover:underline"
          >
            {KIND_LABEL[source.kind]} · {source.label}
          </a>
        ) : (
          <span key={`${source.kind}:${source.id}`}>
            {KIND_LABEL[source.kind]} · {source.label}
          </span>
        ),
      )}
    </p>
  );
}
