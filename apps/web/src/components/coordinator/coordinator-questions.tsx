'use client';

import { CheckCircle2, Clock, MessageSquareReply, X } from 'lucide-react';
import { useState } from 'react';
import {
  QUESTION_ANSWER_MAX,
  type CoordinatorQuestionView,
  type CoordinatorView,
} from '@samadhaan/shared';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { QUESTION_CATEGORY_LABEL } from '@/lib/coordinator';
import { formatRelativeTime } from '@/lib/format';
import { answerQuestion, dismissQuestion } from '@/services/coordinator.service';
import { SourceLinks } from './source-links';

/**
 * The coordinator's questions for the team. One tap for the common answers;
 * free text for the rest. Answers are stored as written, by the person who
 * wrote them, and inform the next analysis. The AI never answers for anyone.
 */
export function CoordinatorQuestions({
  projectId,
  questions,
  canAnswer,
  canDismiss,
  onChange,
}: {
  projectId: string;
  questions: CoordinatorQuestionView[];
  canAnswer: boolean;
  canDismiss: boolean;
  onChange: (view: CoordinatorView) => void;
}) {
  const open = questions.filter((q) => q.status === 'OPEN');
  const answered = questions.filter((q) => q.status === 'ANSWERED');

  return (
    <section aria-labelledby="coordinator-questions" className="space-y-3">
      <h3
        id="coordinator-questions"
        className="flex items-center gap-1.5 type-label text-ink"
      >
        <AiSparkIcon className="text-ai" />
        Coordinator questions
        {open.length > 0 && (
          <span className="rounded-full bg-ai-soft px-1.5 type-overline text-ai">
            {open.length}
            <span className="sr-only"> open</span>
          </span>
        )}
      </h3>
      {open.length === 0 ? (
        <p className="type-caption text-ink-muted">No open questions.</p>
      ) : (
        <ul className="space-y-3">
          {open.map((question) => (
            <QuestionItem
              key={question.id}
              projectId={projectId}
              question={question}
              canAnswer={canAnswer}
              canDismiss={canDismiss}
              onChange={onChange}
            />
          ))}
        </ul>
      )}
      {answered.length > 0 && (
        <details className="type-caption text-ink-muted">
          <summary className="cursor-pointer font-medium text-ink">
            Recently answered ({answered.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {answered.map((q) => (
              <li key={q.id}>
                <p className="text-ink">{q.question}</p>
                <p>
                  {q.answer} — {q.answeredBy?.name ?? 'A participant'},{' '}
                  {q.answeredAt && formatRelativeTime(q.answeredAt)}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function QuestionItem({
  projectId,
  question,
  canAnswer,
  canDismiss,
  onChange,
}: {
  projectId: string;
  question: CoordinatorQuestionView;
  canAnswer: boolean;
  canDismiss: boolean;
  onChange: (view: CoordinatorView) => void;
}) {
  const { toast } = useToast();
  const [writing, setWriting] = useState(false);
  // "Not yet" opens the box: the answer then says why.
  const [quick, setQuick] = useState<'NOT_YET' | undefined>(undefined);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(input: { quick?: 'COMPLETED' | 'NOT_YET'; answer?: string }) {
    setBusy(true);
    setError(null);
    try {
      onChange(await answerQuestion(projectId, question.id, input));
      toast({
        tone: 'success',
        title: 'Answer recorded',
        description: 'It will inform the next analysis.',
      });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not save the answer.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-control border border-ai-border bg-ai-soft/30 p-3">
      <p className="type-caption font-medium text-ai">
        {QUESTION_CATEGORY_LABEL[question.category]}
      </p>
      <p className="mt-0.5 type-body-sm text-ink">{question.question}</p>
      {question.target && <SourceLinks sources={[question.target]} />}
      <p className="mt-1 type-caption text-ink-subtle">
        Asked {formatRelativeTime(question.askedAt)}
      </p>
      {canAnswer && (
        <div className="mt-2 space-y-2">
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label={`Answer: ${question.question}`}
          >
            {question.category === 'TASK_PROGRESS' && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<CheckCircle2 />}
                  disabled={busy}
                  onClick={() => void send({ quick: 'COMPLETED' })}
                >
                  Yes, completed
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Clock />}
                  disabled={busy}
                  onClick={() => {
                    setQuick('NOT_YET');
                    setWriting(true);
                  }}
                >
                  Not yet
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<MessageSquareReply />}
              disabled={busy}
              onClick={() => {
                setQuick(undefined);
                setWriting(true);
              }}
            >
              Add response
            </Button>
            {canDismiss && (
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<X />}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    onChange(await dismissQuestion(projectId, question.id));
                  } catch (caught) {
                    setError(
                      caught instanceof ApiError ? caught.message : 'Could not dismiss.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Dismiss
              </Button>
            )}
          </div>
          {writing && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!text.trim()) {
                  setError('Write a response first.');
                  return;
                }
                void send({ quick, answer: text.trim() });
              }}
            >
              <label htmlFor={`answer-${question.id}`} className="sr-only">
                Your response
              </label>
              <Textarea
                id={`answer-${question.id}`}
                rows={2}
                value={text}
                maxLength={QUESTION_ANSWER_MAX}
                placeholder={
                  quick ? 'What is preventing completion?' : 'Type your update…'
                }
                onChange={(event) => setText(event.target.value)}
              />
              <Button type="submit" size="sm" variant="primary" loading={busy}>
                Send response
              </Button>
            </form>
          )}
          {error && (
            <p role="alert" className="type-caption text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
