import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/format';
import type { CommentSummary } from '@/types/domain';
import { Avatar } from '@/components/ui/avatar';

/**
 * A discussion entry.
 *
 * Rendered without a card border: comments sit in a thread where a boxed
 * treatment would fragment the conversation. Structure comes from the avatar
 * gutter and spacing instead.
 */
export function CommentCard({
  comment,
  className,
}: {
  comment: CommentSummary;
  className?: string;
}) {
  return (
    <article className={cn('flex gap-3', className)}>
      <Avatar name={comment.author.name} src={comment.author.avatarUrl} size="sm" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="type-body-sm font-medium text-ink">{comment.author.name}</span>
          {comment.author.organization && (
            <span className="type-caption text-ink-subtle">
              {comment.author.organization}
            </span>
          )}
          <time className="type-caption text-ink-subtle" dateTime={comment.createdAt}>
            {formatRelativeTime(comment.createdAt)}
          </time>
        </div>

        <p className="mt-1 type-body-sm text-ink">{comment.content}</p>

        {comment.replyCount ? (
          <p className="mt-1.5 inline-flex items-center gap-1.5 type-caption text-ink-muted">
            <MessageSquare className="size-3.5" aria-hidden="true" />
            {comment.replyCount} {comment.replyCount === 1 ? 'reply' : 'replies'}
          </p>
        ) : null}
      </div>
    </article>
  );
}
