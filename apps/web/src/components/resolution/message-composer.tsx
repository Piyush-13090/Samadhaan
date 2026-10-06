'use client';

import { FileText, Paperclip, Send, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  RESOLUTION_ATTACHMENT_TYPES,
  RESOLUTION_MAX_ATTACHMENTS_PER_MESSAGE,
  RESOLUTION_MESSAGE_MAX_LENGTH,
  type ResolutionAttachmentView,
  type ResolutionParticipant,
} from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import { formatFileSize } from '@/lib/resolution';
import { uploadAttachment } from '@/services/resolution.service';

export interface ComposerSubmit {
  body: string;
  mentionUserIds: string[];
  attachmentIds: string[];
}

/** The "@query" being typed at the caret, if any. */
function activeMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, query: match[2]!.toLowerCase() };
}

/**
 * Writes a message. Plain text; Ctrl/⌘+Enter sends (stated under the box).
 *
 * Typing `@` offers the room's participants as a listbox (arrow keys, Enter or
 * Tab to choose, Escape to dismiss). A chosen name is inserted as `@Full Name`
 * and its id sent as a mention — the API keeps only ids of current
 * participants, so the list here is a convenience, not the rule.
 */
export function MessageComposer({
  roomId,
  participants,
  viewerId,
  disabled,
  onSubmit,
}: {
  roomId: string;
  participants: ResolutionParticipant[];
  viewerId: string;
  disabled?: boolean;
  onSubmit: (input: ComposerSubmit) => Promise<void>;
}) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState('');
  const [mentioned, setMentioned] = useState<Map<string, string>>(new Map());
  const [attachments, setAttachments] = useState<ResolutionAttachmentView[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const pendingCaret = useRef<number | null>(null);

  // After a mention is inserted, the caret goes straight after it — before
  // the browser paints, so the next keystroke lands in the right place.
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !textarea.current) return;
    textarea.current.focus();
    textarea.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [body]);

  const others = participants.filter((p) => p.userId !== viewerId);
  const suggestions = mention
    ? others.filter((p) => p.name.toLowerCase().includes(mention.query)).slice(0, 6)
    : [];
  const listOpen = suggestions.length > 0;

  function updateMention(text: string, caret: number) {
    setMention(activeMention(text, caret));
    setHighlight(0);
  }

  function choose(participant: ResolutionParticipant) {
    if (!mention) return;
    const caret = textarea.current?.selectionStart ?? body.length;
    const insert = `@${participant.name} `;
    const next = body.slice(0, mention.start) + insert + body.slice(caret);
    setBody(next);
    setMentioned((current) => new Map(current).set(participant.userId, participant.name));
    setMention(null);
    // Placed after React commits the new text (see the layout effect).
    pendingCaret.current = mention.start + insert.length;
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (attachments.length >= RESOLUTION_MAX_ATTACHMENTS_PER_MESSAGE) {
          setError(`Up to ${RESOLUTION_MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
          break;
        }
        const uploaded = await uploadAttachment(roomId, file);
        setAttachments((current) => [...current, uploaded]);
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The upload failed. Try again.',
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function send() {
    const text = body.trim();
    if (!text) {
      setError('Write a message first.');
      textarea.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    try {
      await onSubmit({
        body: text,
        // Only names still present in the text count as mentions.
        mentionUserIds: [...mentioned]
          .filter(([, name]) => text.includes(`@${name}`))
          .map(([userId]) => userId),
        attachmentIds: attachments.map((a) => a.id),
      });
      setBody('');
      setMentioned(new Map());
      setAttachments([]);
      textarea.current?.focus();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not send. Try again.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      aria-label="Send a message"
      className="relative space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label htmlFor={`${id}-body`} className="sr-only">
        Message
      </label>
      <Textarea
        ref={textarea}
        id={`${id}-body`}
        rows={3}
        value={body}
        disabled={disabled}
        maxLength={RESOLUTION_MESSAGE_MAX_LENGTH}
        placeholder="Write to the room… Type @ to mention someone."
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={`${id}-mentions`}
        aria-autocomplete="list"
        aria-activedescendant={listOpen ? `${id}-mention-${highlight}` : undefined}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          setBody(event.target.value);
          updateMention(event.target.value, event.target.selectionStart);
        }}
        onClick={(event) =>
          updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onKeyDown={(event) => {
          if (listOpen) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlight((h) => (h + 1) % suggestions.length);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              choose(suggestions[highlight]!);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setMention(null);
              return;
            }
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
      />

      {listOpen && (
        <ul
          id={`${id}-mentions`}
          role="listbox"
          aria-label="Mention a participant"
          className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-control border border-border bg-surface py-1 shadow-md"
        >
          {suggestions.map((participant, index) => (
            <li
              key={participant.userId}
              id={`${id}-mention-${index}`}
              role="option"
              aria-selected={index === highlight}
              className={cn(
                'cursor-pointer px-3 py-1.5 type-body-sm',
                index === highlight ? 'bg-primary-soft text-primary' : 'text-ink',
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(participant);
              }}
            >
              {participant.name}
              <span className="ml-1 type-caption text-ink-subtle">
                {participant.side === 'GOVERNMENT' ? 'Government' : 'Organisation'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Files to send">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="inline-flex items-center gap-1.5 rounded-control border border-border bg-subtle/60 py-1 pr-1 pl-2 type-caption text-ink"
            >
              <FileText className="size-3.5 text-ink-subtle" aria-hidden="true" />
              {attachment.fileName}
              <span className="text-ink-subtle">{formatFileSize(attachment.size)}</span>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={`Remove ${attachment.fileName}`}
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((a) => a.id !== attachment.id),
                  )
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="type-caption text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-hint`} className="type-caption text-ink-subtle">
          Ctrl/⌘ + Enter to send. Visible only to room participants.
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            id={`${id}-file`}
            type="file"
            className="sr-only"
            accept={RESOLUTION_ATTACHMENT_TYPES.join(',')}
            disabled={disabled || uploading}
            onChange={(event) => void addFiles(event.target.files)}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leadingIcon={<Paperclip />}
            loading={uploading}
            disabled={disabled}
            onClick={() => fileInput.current?.click()}
          >
            Attach
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            leadingIcon={<Send />}
            loading={sending}
            disabled={disabled || uploading}
          >
            Send
          </Button>
        </div>
      </div>
      <p className="sr-only">Images (JPEG, PNG, WebP) or PDF, up to 10 MB each.</p>
    </form>
  );
}
