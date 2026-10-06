'use client';

import { BookOpen, Info, Lightbulb, Search } from 'lucide-react';
import { Fragment, useState, type FormEvent, type ReactNode } from 'react';
import {
  KNOWLEDGE_QUESTION_MAX,
  type KnowledgeAnswerView,
  type KnowledgeCitation,
  type KnowledgeContext,
} from '@samadhaan/shared';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { SOURCE_TYPE_LABEL } from '@/lib/knowledge';
import { askKnowledge } from '@/services/knowledge.service';

const CONTEXT_LABEL: Record<KnowledgeContext, string> = {
  PROBLEM: 'This problem',
  PROJECT: 'This project',
  GENERAL: 'General',
};

/**
 * Ask Civic Knowledge (Prompt 20).
 *
 * One question, one evidence-backed answer — not a chat. The answer is built
 * only from passages the asker may read, and every claim cites one: [E1] links
 * open the exact passage in its source. When the sources do not cover the
 * question, it says so instead of guessing. Suggestions are labelled as the
 * model's, separate from what the sources state.
 */
export function AskKnowledge({
  problemId,
  projectId,
  className,
}: {
  /** Enables the "This problem" context (a public reference such as SAM-1023). */
  problemId?: string;
  /** Enables the "This project" context. */
  projectId?: string;
  className?: string;
}) {
  const contexts: KnowledgeContext[] = [
    ...(projectId ? (['PROJECT'] as const) : []),
    ...(problemId ? (['PROBLEM'] as const) : []),
    'GENERAL',
  ];
  const [context, setContext] = useState<KnowledgeContext>(contexts[0]!);
  const [question, setQuestion] = useState('');
  const [view, setView] = useState<KnowledgeAnswerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const query = question.trim();
    if (query.length < 3) {
      setError('Ask a question.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      setView(
        await askKnowledge({
          query,
          contextType: context,
          ...(context === 'PROBLEM' ? { problemId } : {}),
          ...(context === 'PROJECT' ? { projectId } : {}),
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The question could not be answered. Try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id="ask-knowledge" className={cn('scroll-mt-24', className)}>
      <CardBody className="space-y-4">
        <div>
          <h2 className="flex items-center gap-1.5 type-h4 text-ink">
            <BookOpen className="size-4 text-primary" aria-hidden="true" />
            Ask Civic Knowledge
          </h2>
          <p className="type-caption text-ink-subtle">
            Answers come only from guidance you are allowed to read, with citations.
            Evidence, not a decision.
          </p>
        </div>

        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          {contexts.length > 1 && (
            <div
              role="radiogroup"
              aria-label="Search in"
              className="flex flex-wrap gap-1.5"
            >
              {contexts.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={context === option}
                  onClick={() => setContext(option)}
                  className={cn(
                    'rounded-full border px-3 py-1 type-caption font-medium',
                    'focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
                    context === option
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border text-ink-muted hover:text-ink',
                  )}
                >
                  {CONTEXT_LABEL[option]}
                </button>
              ))}
            </div>
          )}
          <Field label="Your question" hideLabel error={error ?? undefined}>
            <Textarea
              rows={2}
              value={question}
              maxLength={KNOWLEDGE_QUESTION_MAX}
              placeholder={
                context === 'PROJECT'
                  ? 'e.g. What safety steps apply to this work?'
                  : 'e.g. How quickly should a blocked culvert be cleared?'
              }
              onChange={(event) => setQuestion(event.target.value)}
            />
          </Field>
          <Button type="submit" size="sm" leadingIcon={<Search />} loading={pending}>
            Ask
          </Button>
        </form>

        {view && <AnswerPanel view={view} />}
      </CardBody>
    </Card>
  );
}

function AnswerPanel({ view }: { view: KnowledgeAnswerView }) {
  const byRef = new Map(view.sources.map((s) => [s.ref, s]));
  return (
    <section aria-live="polite" aria-label="Answer" className="space-y-4">
      {view.insufficientEvidence ? (
        <p
          role="status"
          className="flex items-start gap-1.5 rounded-control bg-subtle/60 p-3 type-body-sm text-ink"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          {view.answer ??
            'The knowledge base does not contain enough information to answer this.'}
        </p>
      ) : (
        <div className="rounded-control bg-ai-soft/40 p-3">
          <p className="flex items-center gap-1.5 type-label text-ai">
            <AiSparkIcon /> Answer from the sources
          </p>
          <p className="mt-1 type-body-sm whitespace-pre-line text-ink">
            {withCitations(view.answer ?? '', byRef)}
          </p>
        </div>
      )}
      {view.weakRetrieval && view.sources.length > 0 && (
        <p role="status" className="flex items-start gap-1.5 type-caption text-warning">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          The closest passages are only loosely related to the question. Check them before
          relying on this answer.
        </p>
      )}

      {view.suggestions.length > 0 && (
        <div>
          <h3 className="flex items-center gap-1.5 type-label text-ink">
            <Lightbulb className="size-4 text-ai" aria-hidden="true" /> Suggestions
          </h3>
          <p className="type-caption text-ink-subtle">
            The model&rsquo;s own suggestions — not stated by the sources.
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 type-body-sm text-ink">
            {view.suggestions.map((suggestion, index) => (
              <li key={index}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}

      {view.sources.length > 0 && (
        <div>
          <h3 className="type-label text-ink">Sources</h3>
          <ol className="mt-1.5 space-y-2">
            {view.sources.map((citation) => (
              <CitationItem key={citation.chunkId} citation={citation} />
            ))}
          </ol>
        </div>
      )}

      <p className="type-caption text-ink-subtle">
        {view.model
          ? `${view.model.name} (${view.model.provider}) · prompt ${view.model.promptVersion} · `
          : 'No model ran · '}
        retrieval {view.retrieval.retrievalVersion} · {view.retrieval.embeddingModel} ·{' '}
        <time dateTime={view.answeredAt}>{formatDateTime(view.answeredAt)}</time>
      </p>
    </section>
  );
}

function CitationItem({ citation }: { citation: KnowledgeCitation }) {
  const location = [
    citation.sectionTitle,
    citation.pageNumber ? `page ${citation.pageNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li id={`citation-${citation.ref}`} className="type-body-sm">
      <p className="flex flex-wrap items-center gap-1.5">
        <Badge size="sm" tone={citation.cited ? 'primary' : 'neutral'}>
          {citation.ref}
        </Badge>
        <a
          href={citation.href}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {citation.title}
        </a>
        <span className="type-caption text-ink-subtle">
          {SOURCE_TYPE_LABEL[citation.sourceType]}
          {location ? ` · ${location}` : ''} · relevance{' '}
          {citation.relevanceScore.toFixed(2)}
          {!citation.cited ? ' · retrieved, not cited' : ''}
        </span>
      </p>
      <p className="mt-0.5 line-clamp-3 type-caption text-ink-muted">
        {citation.excerpt}
      </p>
    </li>
  );
}

/** Turns [E1] markers into links to the cited passage. Unknown refs stay plain text. */
function withCitations(text: string, byRef: Map<string, KnowledgeCitation>): ReactNode[] {
  return text.split(/(\[E\d{1,3}\])/g).map((part, index) => {
    const ref = /^\[(E\d{1,3})\]$/.exec(part)?.[1];
    const citation = ref ? byRef.get(ref) : undefined;
    if (!citation) return <Fragment key={index}>{part}</Fragment>;
    return (
      <a
        key={index}
        href={citation.href}
        title={`${citation.title}${citation.sectionTitle ? ` — ${citation.sectionTitle}` : ''}`}
        className="align-super type-caption font-medium text-primary hover:underline"
      >
        [{ref}]
      </a>
    );
  });
}
