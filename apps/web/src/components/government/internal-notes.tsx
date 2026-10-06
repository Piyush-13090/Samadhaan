'use client';

import { Lock, NotebookPen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { INTERNAL_NOTE_MAX_LENGTH, type GovernmentInternalNote } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-error';
import { formatDateTime } from '@/lib/format';
import { addInternalNote } from '@/services/government.service';

/**
 * Internal notes: visible to this office's officials, and nobody else. The
 * privacy is the API's — notes live in their own table, and only the
 * government API reads them, for the office that wrote them — not this
 * component's.
 */
export function InternalNotes({
  slug,
  publicId,
  notes,
  canAdd,
}: {
  slug: string;
  publicId: string;
  notes: GovernmentInternalNote[];
  canAdd: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (body.trim().length < 2) {
      setError('Write the note first.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await addInternalNote(slug, publicId, body.trim());
      setBody('');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Check your connection and try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Internal notes"
        description="Only officials of your office can see these."
        icon={<Lock className="size-4" />}
      />
      <CardBody className="space-y-4">
        {notes.length === 0 ? (
          <p className="type-body-sm text-ink-muted">No internal notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((note) => (
              <li
                key={note.id}
                className="rounded-control border border-border-subtle bg-subtle/50 px-3 py-2.5"
              >
                <p className="whitespace-pre-line type-body-sm text-ink">{note.body}</p>
                <p className="mt-1 type-caption text-ink-subtle">
                  {note.author.name} · {formatDateTime(note.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {canAdd && (
          <form
            onSubmit={(event) => void onSubmit(event)}
            className="space-y-2"
            noValidate
          >
            <Field label="Add an internal note" error={error ?? undefined}>
              <Textarea
                rows={3}
                value={body}
                maxLength={INTERNAL_NOTE_MAX_LENGTH}
                placeholder="e.g. Site inspection required before allocation."
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              leadingIcon={<NotebookPen />}
              loading={pending}
            >
              Add note
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
