import type { ReactNode } from 'react';
import type { CommentView } from '@samadhaan/shared';
import { cn } from '@/lib/cn';
import { formatDate, formatRelativeTime } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/role-display';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

/**
 * A discussion entry.
 *
 * Rendered without a card border: comments sit in a thread where a boxed
 * treatment would fragment the conversation. Structure comes from the avatar
 * gutter and spacing instead.
 *
 * The body is a **text node**, always. A comment is user input; it is never
 * parsed as markup, so `<script>` in a comment is shown as those characters.
 * `whitespace-pre-line` keeps the author's paragraphs without any HTML.
 *
 * Presentational only. Edit and delete controls, and the editor itself, are
 * passed in by the thread, which owns the state.
 */
export function CommentCard({
  comment,
  actions,
  children,
  size = 'md',
  className,
}: {
  comment: CommentView;
  /** Reply / edit / delete controls, under the body. */
  actions?: ReactNode;
  /** Replaces the body — an inline editor while editing. */
  children?: ReactNode;
  /** Replies use the smaller avatar. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  if (comment.isRemoved || !comment.author) {
    return (
      <article className={cn('flex gap-3', className)} aria-label="Removed comment">
        <span
          aria-hidden="true"
          className={cn(
            'shrink-0 rounded-full border border-dashed border-border-strong',
            size === 'md' ? 'size-8' : 'size-6',
          )}
        />
        <p className="pt-1 type-body-sm text-ink-subtle italic">
          This comment was removed.
        </p>
      </article>
    );
  }

  const { author } = comment;
  // Only roles that change how a reader weighs the comment are labelled; a
  // badge on every citizen would be noise.
  const roleLabel = author.role === 'CITIZEN' ? null : ROLE_LABEL[author.role];

  return (
    <article
      className={cn('flex gap-3', className)}
      aria-label={`Comment by ${author.name}`}
    >
      <Avatar
        name={author.name}
        src={author.avatarUrl ?? undefined}
        size={size === 'md' ? 'sm' : 'xs'}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="type-body-sm font-medium text-ink">{author.name}</span>
          {author.isReporter && (
            <Badge tone="primary" size="sm">
              Reporter
            </Badge>
          )}
          {roleLabel && (
            <Badge tone="neutral" size="sm">
              {roleLabel}
            </Badge>
          )}
          <time
            className="type-caption text-ink-subtle"
            dateTime={comment.createdAt}
            title={formatDate(comment.createdAt)}
          >
            {formatRelativeTime(comment.createdAt)}
          </time>
          {comment.isEdited && (
            <span className="type-caption text-ink-subtle">· edited</span>
          )}
        </div>

        {children ?? (
          <p className="mt-1 type-body-sm break-words whitespace-pre-line text-ink">
            {comment.body}
          </p>
        )}

        {actions && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">{actions}</div>
        )}
      </div>
    </article>
  );
}
