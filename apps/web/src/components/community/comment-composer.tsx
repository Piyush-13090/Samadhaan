'use client';

import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { COMMENT_BODY_MAX_LENGTH, COMMENT_BODY_MIN_LENGTH } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-error';

/**
 * A comment form: new comment, reply or edit.
 *
 * Validates on the client for a fast answer, but only as a courtesy — the API
 * normalises and re-validates everything, and its message replaces this one
 * when they disagree. The length check here mirrors the server's: trimmed, so
 * a body of spaces is "empty" in both places.
 */
export function CommentComposer({
  label,
  hideLabel = false,
  placeholder,
  submitLabel,
  initialValue = '',
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  label: string;
  hideLabel?: boolean;
  placeholder?: string;
  submitLabel: string;
  initialValue?: string;
  autoFocus?: boolean;
  /** Resolves on success; the form then clears. Throws to show an error. */
  onSubmit: (body: string) => Promise<void>;
  /** Shows a Cancel button; Escape triggers it too. */
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formId = useId();

  const trimmed = value.trim();
  const tooShort = trimmed.length < COMMENT_BODY_MIN_LENGTH;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (submitting) return;

    if (tooShort) {
      setError(
        trimmed.length === 0
          ? 'Write a comment first.'
          : `Write at least ${COMMENT_BODY_MIN_LENGTH} characters.`,
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(value);
      setValue('');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.status === 401
            ? 'Your session has expired. Please sign in again.'
            : caught.message
          : 'Could not post. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
    // Ctrl/Cmd+Enter posts, the convention in every comment box people know.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form
      id={formId}
      onSubmit={(event) => void submit(event)}
      className="space-y-2"
      noValidate
    >
      <Field label={label} hideLabel={hideLabel} error={error ?? undefined}>
        <Textarea
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={COMMENT_BODY_MAX_LENGTH}
          showCount
          rows={3}
          // Focus is moved deliberately, in response to the user opening a
          // reply or edit box — never on page load.
          autoFocus={autoFocus}
        />
      </Field>

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" size="sm" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
