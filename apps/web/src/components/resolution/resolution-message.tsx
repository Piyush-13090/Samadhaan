'use client';

import { FileText, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  RESOLUTION_MESSAGE_MAX_LENGTH,
  type ResolutionMessageView,
} from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { SIDE_LABEL, formatFileSize } from '@/lib/resolution';
import { ParticipantAvatar } from './participant-avatar';

/**
 * Renders a body as text, highlighting stored mentions. Never markup: the
 * body is split into strings and React renders each as a text node, so
 * `<script>` in a message is shown, not run.
 */
export function renderBody(body: string, mentions: Array<{ name: string }>): ReactNode[] {
  const names = [...new Set(mentions.map((m) => `@${m.name}`))].sort(
    (a, b) => b.length - a.length,
  );
  if (names.length === 0) return [body];
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = body.split(new RegExp(`(${escaped.join('|')})`, 'g'));
  return parts.map((part, index) =>
    names.includes(part) ? (
      <span
        key={index}
        className="rounded-[4px] bg-primary-soft px-0.5 font-medium text-primary"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function ResolutionMessage({
  message,
  isOwn,
  canChange,
  onEdit,
  onDelete,
}: {
  message: ResolutionMessageView;
  isOwn: boolean;
  /** The room is open. */
  canChange: boolean;
  onEdit: (body: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const time = new Date(message.createdAt).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const deleted = message.deletedAt !== null;

  async function save() {
    const body = draft.trim();
    if (!body) {
      setError('A message cannot be empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onEdit(body);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article
      id={`message-${message.id}`}
      aria-label={`${message.author.name}, ${message.author.organizationName}, ${formatDateTime(message.createdAt)}`}
      className="group flex gap-3 rounded-control px-2 py-2 hover:bg-subtle/50"
    >
      <ParticipantAvatar
        name={message.author.name}
        avatarUrl={message.author.avatarUrl}
        side={message.author.side}
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="type-body-sm font-semibold text-ink">
            {message.author.name}
          </span>
          <span className="type-caption text-ink-muted">
            {message.author.organizationName}
            <span className="sr-only"> ({SIDE_LABEL[message.author.side]})</span>
          </span>
          <time
            dateTime={message.createdAt}
            title={formatDateTime(message.createdAt)}
            className="type-caption text-ink-subtle"
          >
            {time}
          </time>
          {message.editedAt && !deleted && (
            <span className="type-caption text-ink-subtle">(Edited)</span>
          )}
        </p>

        {deleted ? (
          <p className="mt-0.5 type-body-sm italic text-ink-subtle">Message deleted</p>
        ) : editing ? (
          <div className="mt-1 space-y-2">
            <label className="sr-only" htmlFor={`edit-${message.id}`}>
              Edit message
            </label>
            <Textarea
              id={`edit-${message.id}`}
              rows={3}
              value={draft}
              maxLength={RESOLUTION_MESSAGE_MAX_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(false);
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                  void save();
              }}
              autoFocus
            />
            {error && (
              <p role="alert" className="type-caption text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={saving}
                onClick={() => void save()}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap break-words type-body-sm text-ink">
            {renderBody(message.body ?? '', message.mentions)}
          </p>
        )}

        {!deleted && message.attachments.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attachments">
            {message.attachments.map((attachment) => (
              <li key={attachment.id}>
                {attachment.mimeType.startsWith('image/') ? (
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-control border border-border focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- authorised, same-origin file */}
                    <img
                      src={attachment.url}
                      alt={attachment.fileName}
                      className="h-28 w-40 bg-subtle object-cover"
                    />
                  </a>
                ) : (
                  <a
                    href={attachment.url}
                    className="inline-flex items-center gap-2 rounded-control border border-border px-3 py-2 type-caption text-ink hover:bg-subtle focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                  >
                    <FileText className="size-4 text-ink-subtle" aria-hidden="true" />
                    {attachment.fileName}
                    <span className="text-ink-subtle">
                      {formatFileSize(attachment.size)}
                    </span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {isOwn && canChange && !deleted && !editing && (
        <div
          className={cn(
            'flex shrink-0 items-start gap-0.5 opacity-100 sm:opacity-0',
            'sm:group-hover:opacity-100 sm:focus-within:opacity-100',
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Edit your message"
            onClick={() => {
              setDraft(message.body ?? '');
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Delete your message"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </article>
  );
}
