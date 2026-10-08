'use client';

import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Circle,
  Info,
  ShieldAlert,
} from 'lucide-react';
import { useState } from 'react';
import {
  VERIFICATION_LIMITATIONS,
  type MissingEvidenceItem,
  type VerificationAssessmentView,
} from '@samadhaan/shared';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/format';
import { RECOMMENDATION_DISPLAY } from '@/lib/verification';

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The AI's review of one evidence item (Prompt 22). Always labelled advisory,
 * always with its limits: it never says "resolved" — only an official does.
 */
export function AiVerificationReview({
  assessment,
  className,
}: {
  assessment: VerificationAssessmentView;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const rec = assessment.recommendation
    ? RECOMMENDATION_DISPLAY[assessment.recommendation]
    : null;

  return (
    <section
      aria-label="AI verification review"
      className={cn(
        'space-y-3 rounded-control border border-ai-border bg-ai-soft/30 p-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-1.5 type-label text-ai">
          <AiSparkIcon /> AI verification review
        </h4>
        <Badge size="sm" tone="ai">
          Advisory
        </Badge>
        {rec ? (
          <Badge size="sm" tone={rec.tone}>
            {rec.label}
          </Badge>
        ) : (
          <span className="type-caption text-ink-muted">
            {assessment.status === 'FAILED'
              ? 'AI review unavailable'
              : 'No AI model ran — review the evidence directly'}
          </span>
        )}
        {assessment.confidence !== null && rec && (
          <span className="type-caption text-ink-muted">
            Confidence {pct(assessment.confidence)}
          </span>
        )}
        {assessment.evidenceQuality !== null && (
          <span className="type-caption text-ink-muted">
            Evidence quality {Math.round(assessment.evidenceQuality)}/100
          </span>
        )}
      </div>

      {assessment.failureMessage && (
        <p className="type-caption text-ink-muted">{assessment.failureMessage}</p>
      )}
      {assessment.adjustments.length > 0 && (
        <p className="flex items-start gap-1.5 type-caption text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Made more cautious than the model’s own view: {assessment.adjustments.join(' ')}
        </p>
      )}

      {(assessment.supporting.length > 0 || assessment.remainingIssues.length > 0) && (
        <ul className="space-y-1">
          {assessment.supporting.map((o, i) => (
            <li key={`s${i}`} className="flex items-start gap-1.5 type-body-sm text-ink">
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-success"
                aria-hidden="true"
              />
              <span>
                <span className="sr-only">Supports: </span>
                {o.text}{' '}
                <span className="type-caption text-ink-subtle">
                  ({o.refs.join(', ')})
                </span>
              </span>
            </li>
          ))}
          {assessment.remainingIssues.map((o, i) => (
            <li key={`r${i}`} className="flex items-start gap-1.5 type-body-sm text-ink">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-warning"
                aria-hidden="true"
              />
              <span>
                <span className="sr-only">Against: </span>
                {o.text}{' '}
                <span className="type-caption text-ink-subtle">
                  ({o.refs.join(', ')})
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {assessment.concerns.length > 0 && <Concerns concerns={assessment.concerns} />}

      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 type-caption font-medium text-primary hover:underline"
      >
        <ChevronDown
          className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
          aria-hidden="true"
        />
        Signals, expected evidence and limitations
      </button>
      {expanded && (
        <div className="space-y-3">
          <dl className="grid gap-1 sm:grid-cols-2">
            {assessment.signals.map((s) => (
              <div key={s.key} className="type-caption">
                <dt className="text-ink-muted">{s.label}</dt>
                <dd className="text-ink">
                  {s.value === null ? 'Unavailable' : pct(s.value)}
                  <span className="block text-ink-subtle">{s.source}</span>
                </dd>
              </div>
            ))}
          </dl>
          <MissingEvidence items={assessment.missingEvidence} />
          {assessment.guidance.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 type-caption font-medium text-ink">
                <BookOpen className="size-3.5" aria-hidden="true" /> Guidance the review
                considered
              </p>
              <ul>
                {assessment.guidance.map((g) => (
                  <li key={g.href}>
                    <a
                      href={g.href}
                      className="type-caption text-primary hover:underline"
                    >
                      {g.title}
                      {g.sectionTitle ? ` — ${g.sectionTitle}` : ''}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Limitations />
          <p className="type-caption text-ink-subtle">
            {assessment.model
              ? `${assessment.model.name} · prompt ${assessment.model.promptVersion ?? '—'} · ${assessment.model.verificationVersion}`
              : 'No model'}{' '}
            · {formatRelativeTime(assessment.createdAt)}
          </p>
        </div>
      )}
    </section>
  );
}

export function Concerns({
  concerns,
}: {
  concerns: VerificationAssessmentView['concerns'];
}) {
  return (
    <div className="rounded-control border border-warning-border bg-warning-soft/40 p-2">
      <p className="flex items-center gap-1.5 type-caption font-semibold text-warning">
        <ShieldAlert className="size-3.5" aria-hidden="true" /> Potential evidence concern
      </p>
      <ul className="mt-1 space-y-0.5">
        {concerns.map((c) => (
          <li key={c.code} className="type-caption text-ink">
            {c.text}
          </li>
        ))}
      </ul>
      <p className="mt-1 type-caption text-ink-subtle">
        Signals to check, not accusations.
      </p>
    </div>
  );
}

export function MissingEvidence({ items }: { items: MissingEvidenceItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="type-caption font-medium text-ink">
        Expected evidence for this kind of problem
      </p>
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => (
          <li key={item.kind} className="flex items-start gap-1.5 type-caption">
            {item.satisfied ? (
              <CheckCircle2
                className="mt-0.5 size-3.5 shrink-0 text-success"
                aria-hidden="true"
              />
            ) : (
              <Circle
                className="mt-0.5 size-3.5 shrink-0 text-ink-subtle"
                aria-hidden="true"
              />
            )}
            <span className={item.satisfied ? 'text-ink' : 'text-ink-muted'}>
              <span className="sr-only">
                {item.satisfied ? 'Present: ' : 'Missing: '}
              </span>
              {item.label}
              {item.required ? '' : ' (suggested)'}
              {item.satisfiedBy ? ` — ${item.satisfiedBy}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Limitations({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-control bg-subtle/60 p-2', className)}>
      <p className="type-caption font-medium text-ink">What AI review cannot do</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 type-caption text-ink-muted">
        {VERIFICATION_LIMITATIONS.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
