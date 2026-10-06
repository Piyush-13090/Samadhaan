'use client';

import { Check, PenLine, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  UPDATE_EXTRACT_TEXT_MAX,
  type ExtractedUpdateView,
  type ProjectUpdateView,
} from '@samadhaan/shared';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { linesToItems } from '@/lib/coordinator';
import { formatRelativeTime } from '@/lib/format';
import {
  draftUpdate,
  fetchUpdates,
  postUpdate,
  type UpdateInput,
} from '@/services/coordinator.service';

interface Draft {
  summary: string;
  completed: string;
  current: string;
  blockers: string;
  nextSteps: string;
}

const EMPTY: Draft = {
  summary: '',
  completed: '',
  current: '',
  blockers: '',
  nextSteps: '',
};

/**
 * Structured progress updates. A person writes one — or asks the coordinator
 * to draft one from a note or from the team's recent messages, then reviews
 * it: **Accept**, **Edit** or **Dismiss**. Nothing is saved until its author
 * confirms, and the draft never changes a task or the project.
 */
export function ProjectUpdates({
  projectId,
  canPost,
  onPosted,
}: {
  projectId: string;
  canPost: boolean;
  onPosted: () => void;
}) {
  const { toast } = useToast();
  const [updates, setUpdates] = useState<ProjectUpdateView[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'note' | 'form'>('idle');
  const [note, setNote] = useState('');
  const [suggestion, setSuggestion] = useState<ExtractedUpdateView | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetchUpdates(projectId)
        .then((page) => setUpdates(page.items))
        .catch(() => setUpdates([])),
    [projectId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function requestDraft(input: { text?: string; fromRecentMessages?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      setSuggestion(await draftUpdate(projectId, input));
      setMode('idle');
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The draft could not be generated.',
      );
    } finally {
      setBusy(false);
    }
  }

  function toDraft(s: ExtractedUpdateView): Draft {
    return {
      summary: s.summary,
      completed: s.completed.join('\n'),
      current: s.current.join('\n'),
      blockers: s.blockers.join('\n'),
      nextSteps: s.nextSteps.join('\n'),
    };
  }

  async function save(input: UpdateInput) {
    setBusy(true);
    setError(null);
    try {
      await postUpdate(projectId, input);
      toast({ tone: 'success', title: 'Update posted' });
      setSuggestion(null);
      setDraft(EMPTY);
      setAiModel(null);
      setMode('idle');
      void load();
      onPosted();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not post the update.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="updates" className="scroll-mt-24">
      <CardHeader
        title="Progress updates"
        description="Structured updates from the assigned team."
        action={
          canPost && mode === 'idle' && !suggestion ? (
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Plus />}
                onClick={() => setMode('form')}
              >
                Post update
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<AiSparkIcon />}
                onClick={() => setMode('note')}
              >
                Draft with AI
              </Button>
            </div>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        {mode === 'note' && (
          <div className="space-y-2 rounded-control border border-ai-border p-3">
            <Field
              label="Your note"
              hint="Plain words are fine. The draft uses only what you write."
            >
              <Textarea
                rows={3}
                value={note}
                maxLength={UPDATE_EXTRACT_TEXT_MAX}
                placeholder="Inspection is done. Materials are being ordered today."
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<AiSparkIcon />}
                loading={busy}
                onClick={() => void requestDraft({ text: note })}
              >
                Draft from note
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={() => void requestDraft({ fromRecentMessages: true })}
              >
                Draft from recent room messages
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {suggestion && mode !== 'form' && (
          <section
            aria-labelledby="ai-suggested-update"
            className="rounded-control border border-ai-border bg-ai-soft/30 p-3"
          >
            <h3
              id="ai-suggested-update"
              className="flex items-center gap-1.5 type-label text-ai"
            >
              <AiSparkIcon /> AI suggested update
            </h3>
            <p className="mt-1 type-body-sm text-ink">{suggestion.summary}</p>
            <UpdateLists update={suggestion} />
            <p className="mt-2 type-caption text-ink-subtle">
              Drafted by {suggestion.model.name}. Check it before posting — nothing is
              saved yet.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<Check />}
                loading={busy}
                onClick={() =>
                  void save({
                    summary: suggestion.summary,
                    completed: suggestion.completed,
                    current: suggestion.current,
                    blockers: suggestion.blockers,
                    nextSteps: suggestion.nextSteps,
                    source: 'AI_ASSISTED',
                    aiModel: suggestion.model.name,
                  })
                }
              >
                Accept update
              </Button>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<PenLine />}
                onClick={() => {
                  setDraft(toDraft(suggestion));
                  setAiModel(suggestion.model.name);
                  setMode('form');
                }}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<X />}
                onClick={() => setSuggestion(null)}
              >
                Dismiss
              </Button>
            </div>
          </section>
        )}

        {mode === 'form' && (
          <form
            className="space-y-3 rounded-control border border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.summary.trim()) {
                setError('Summarise the update.');
                return;
              }
              void save({
                summary: draft.summary.trim(),
                completed: linesToItems(draft.completed),
                current: linesToItems(draft.current),
                blockers: linesToItems(draft.blockers),
                nextSteps: linesToItems(draft.nextSteps),
                source: aiModel ? 'AI_ASSISTED' : 'MANUAL',
                ...(aiModel ? { aiModel } : {}),
              });
            }}
          >
            <Field label="Summary" required>
              <Input
                value={draft.summary}
                maxLength={400}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['completed', 'Completed'],
                  ['current', 'In progress'],
                  ['blockers', 'Blockers'],
                  ['nextSteps', 'Next steps'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label} hint="One item per line.">
                  <Textarea
                    rows={3}
                    value={draft[key]}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Button type="submit" size="sm" variant="primary" loading={busy}>
                Post update
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMode('idle');
                  setDraft(EMPTY);
                  setAiModel(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="type-body-sm text-danger">
            {error}
          </p>
        )}

        {updates === null ? (
          <p className="type-body-sm text-ink-muted">Loading updates…</p>
        ) : updates.length === 0 ? (
          <p className="type-body-sm text-ink-muted">No progress updates yet.</p>
        ) : (
          <ol className="space-y-4" aria-label="Progress updates">
            {updates.map((update) => (
              <li
                key={update.id}
                id={`update-${update.id}`}
                className="scroll-mt-24 border-l-2 border-border pl-3"
              >
                <p className="flex flex-wrap items-center gap-1.5 type-body-sm font-medium text-ink">
                  {update.summary}
                  {update.source === 'AI_ASSISTED' && (
                    <Badge tone="ai" size="sm" icon={<AiSparkIcon />}>
                      AI-assisted, confirmed by author
                    </Badge>
                  )}
                </p>
                <UpdateLists update={update} />
                <p className="mt-1 type-caption text-ink-subtle">
                  {update.author.name} · {update.author.organizationName} ·{' '}
                  {formatRelativeTime(update.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

function UpdateLists({
  update,
}: {
  update: {
    completed: string[];
    current: string[];
    blockers: string[];
    nextSteps: string[];
  };
}) {
  const groups = [
    ['Completed', update.completed],
    ['In progress', update.current],
    ['Blockers', update.blockers],
    ['Next', update.nextSteps],
  ] as const;
  return (
    <dl className="mt-2 grid gap-2 type-caption sm:grid-cols-2">
      {groups.map(([label, items]) => (
        <div key={label}>
          <dt className="font-medium text-ink-muted">{label}</dt>
          <dd className="text-ink">{items.length ? items.join('; ') : 'None'}</dd>
        </div>
      ))}
    </dl>
  );
}
