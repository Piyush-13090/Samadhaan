'use client';

import { CheckCircle2, MessageSquareWarning, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  VERIFICATION_REASON_MAX,
  VERIFICATION_REASON_MIN,
  type GovernmentVerificationView,
} from '@samadhaan/shared';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ErrorState } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { formatDate, formatRelativeTime } from '@/lib/format';
import { RECOMMENDATION_DISPLAY, REQUEST_STATUS_DISPLAY } from '@/lib/verification';
import {
  analyzeEvidence,
  approveResolution,
  fetchGovernmentVerification,
  rejectResolution,
  requestMoreEvidence,
} from '@/services/verification.service';
import { Concerns, Limitations, MissingEvidence } from './ai-verification-review';
import { EvidenceCard } from './evidence-card';
import { VerificationTimeline } from './project-evidence-panel';

type Decision = 'approve' | 'request' | 'reject';

const DECISION: Record<
  Decision,
  {
    title: string;
    action: string;
    needsReason: boolean;
    tone: 'primary' | 'danger' | 'secondary';
  }
> = {
  approve: {
    title: 'Approve the resolution',
    action: 'Approve resolution',
    needsReason: false,
    tone: 'primary',
  },
  request: {
    title: 'Request more evidence',
    action: 'Request evidence',
    needsReason: true,
    tone: 'secondary',
  },
  reject: {
    title: 'Reject the resolution',
    action: 'Reject resolution',
    needsReason: true,
    tone: 'danger',
  },
};

/**
 * Resolution verification for an office (Prompt 22): the original problem, the
 * project's progress, every piece of evidence with its raw files, the AI's
 * advisory review, expected evidence, history — and the decision, which only
 * an official makes. Approval resolves the problem and completes the project
 * together.
 */
export function GovernmentVerificationPanel({
  slug,
  publicId,
}: {
  slug: string;
  publicId: string;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<GovernmentVerificationView | null>(null);
  const [failed, setFailed] = useState(false);
  const [deciding, setDeciding] = useState<Decision | null>(null);

  const load = useCallback(
    () =>
      fetchGovernmentVerification(slug, publicId)
        .then((next) => {
          setView(next);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [slug, publicId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (failed && !view) {
    return (
      <Card id="verification">
        <ErrorState
          size="sm"
          title="Verification could not be loaded"
          onRetry={() => void load()}
        />
      </Card>
    );
  }
  if (!view) return null;
  // Nothing to verify before an organisation has a project from this office.
  if (!view.project) return null;

  const rec = view.rollup.recommendation
    ? RECOMMENDATION_DISPLAY[view.rollup.recommendation]
    : null;
  const decided = view.history.filter((h) => h.status !== 'PENDING');
  return (
    <Card id="verification" className="scroll-mt-24">
      <CardHeader
        title="Resolution verification"
        description="Inspect the evidence yourself. The AI review is advisory; your decision is final."
      />
      <CardBody className="space-y-5">
        {view.problem.status === 'RESOLVED' && view.problem.resolvedAt && (
          <Alert tone="success" title="Resolved">
            Approved {formatDate(view.problem.resolvedAt)}. The project is complete.
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <section aria-labelledby="verification-original" className="space-y-2">
            <h3 id="verification-original" className="type-label text-ink">
              Original problem — before
            </h3>
            <p className="type-body-sm text-ink-muted">{view.problem.description}</p>
            {view.problem.beforeImages.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {view.problem.beforeImages.map((image, i) => (
                  <a
                    key={image.url}
                    href={image.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- report photo */}
                    <img
                      src={image.url}
                      alt={`Report photo B${i + 1}`}
                      className="aspect-[4/3] w-full rounded-control object-cover"
                    />
                    <span className="type-caption text-ink-subtle">B{i + 1}</span>
                  </a>
                ))}
              </div>
            )}
          </section>
          <section aria-labelledby="verification-project" className="space-y-2">
            <h3 id="verification-project" className="type-label text-ink">
              Project progress
            </h3>
            <p className="type-body-sm text-ink">
              <Link
                href={`/resolution/${view.project.roomId}/project`}
                className="text-primary hover:underline"
              >
                {view.project.name}
              </Link>{' '}
              · {view.project.organizationName} · {view.project.status.toLowerCase()}
            </p>
            <ProgressBar
              value={view.project.taskProgress}
              label="Task progress"
              showLabel
              size="sm"
            />
            <p className="type-caption text-ink-muted">
              {view.project.completedTasks} tasks completed, {view.project.openTasks} open
            </p>
            {view.project.milestones.length > 0 && (
              <ul className="type-caption text-ink-muted">
                {view.project.milestones.map((m) => (
                  <li key={m.title}>
                    {m.completed ? '✓' : '○'} {m.title}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {view.evidence.length > 0 && (
          <section
            aria-labelledby="verification-ai"
            className="space-y-2 rounded-control border border-ai-border bg-ai-soft/30 p-3"
          >
            <h3
              id="verification-ai"
              className="flex flex-wrap items-center gap-2 type-label text-ai"
            >
              <AiSparkIcon /> AI verification — advisory
              {rec && (
                <Badge size="sm" tone={rec.tone}>
                  {rec.label}
                </Badge>
              )}
            </h3>
            <p className="type-caption text-ink-muted">
              {rec
                ? `Latest review${view.rollup.confidence !== null ? ` · confidence ${Math.round(view.rollup.confidence * 100)}%` : ''}${
                    view.rollup.evidenceQuality !== null
                      ? ` · evidence quality ${Math.round(view.rollup.evidenceQuality)}/100`
                      : ''
                  }. Not a decision.`
                : 'No AI recommendation is available. Review the evidence directly.'}
            </p>
            {view.rollup.concerns.length > 0 && (
              <Concerns concerns={view.rollup.concerns} />
            )}
          </section>
        )}

        <section aria-labelledby="verification-evidence" className="space-y-3">
          <h3 id="verification-evidence" className="type-label text-ink">
            Evidence
          </h3>
          {view.evidence.length === 0 ? (
            <p className="type-body-sm text-ink-muted">
              The organisation has not submitted evidence yet.
            </p>
          ) : (
            view.evidence.map((e) => (
              <EvidenceCard
                key={e.id}
                evidence={e}
                onAnalyze={async () => {
                  try {
                    await analyzeEvidence(e.id);
                    toast({ tone: 'success', title: 'AI review requested' });
                  } catch (caught) {
                    toast({
                      tone: 'danger',
                      title: 'Not requested',
                      description:
                        caught instanceof ApiError ? caught.message : undefined,
                    });
                  }
                  void load();
                }}
              />
            ))
          )}
        </section>

        <MissingEvidence items={view.missingEvidence} />

        {view.canDecide ? (
          <section
            aria-labelledby="verification-decision"
            className="space-y-2 rounded-control border border-border p-3"
          >
            <h3 id="verification-decision" className="type-label text-ink">
              Your decision
            </h3>
            {view.request && (
              <p className="type-caption text-ink-muted">
                Requested by {view.request.requestedBy}{' '}
                {formatRelativeTime(view.request.createdAt)}
                {view.request.note ? ` — “${view.request.note}”` : ''}
              </p>
            )}
            {view.approvalBlockers.length > 0 && (
              <ul className="list-disc pl-5 type-caption text-warning">
                {view.approvalBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                leadingIcon={<CheckCircle2 />}
                disabled={view.approvalBlockers.length > 0}
                onClick={() => setDeciding('approve')}
              >
                Approve resolution
              </Button>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<MessageSquareWarning />}
                onClick={() => setDeciding('request')}
              >
                Request more evidence
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<XCircle />}
                onClick={() => setDeciding('reject')}
              >
                Reject resolution
              </Button>
            </div>
          </section>
        ) : (
          view.problem.status !== 'RESOLVED' && (
            <p className="type-caption text-ink-muted">
              A decision becomes available when the organisation requests verification.
            </p>
          )
        )}

        {decided.length > 0 && (
          <section aria-labelledby="verification-decisions">
            <h3 id="verification-decisions" className="type-label text-ink">
              Earlier decisions
            </h3>
            <ul className="mt-1 space-y-1">
              {decided.map((d) => (
                <li key={d.id} className="type-caption text-ink-muted">
                  <Badge size="sm" tone={REQUEST_STATUS_DISPLAY[d.status].tone}>
                    {REQUEST_STATUS_DISPLAY[d.status].label}
                  </Badge>{' '}
                  {d.decidedAt ? formatDate(d.decidedAt) : ''}
                  {d.decisionReason ? ` — ${d.decisionReason}` : ''}
                  {d.decisionNote ? ` — ${d.decisionNote}` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}

        <VerificationTimeline entries={view.timeline} />
        <Limitations />
      </CardBody>

      <Modal open={deciding !== null} onOpenChange={(open) => !open && setDeciding(null)}>
        {deciding && (
          <DecisionForm
            decision={deciding}
            onSubmit={async (text) => {
              const next =
                deciding === 'approve'
                  ? await approveResolution(slug, publicId, text || undefined)
                  : deciding === 'reject'
                    ? await rejectResolution(slug, publicId, text)
                    : await requestMoreEvidence(slug, publicId, text);
              setView(next);
              setDeciding(null);
              toast({
                tone: 'success',
                title:
                  deciding === 'approve'
                    ? 'Resolution approved — problem resolved'
                    : deciding === 'reject'
                      ? 'Resolution rejected'
                      : 'More evidence requested',
              });
            }}
          />
        )}
      </Modal>
    </Card>
  );
}

function DecisionForm({
  decision,
  onSubmit,
}: {
  decision: Decision;
  onSubmit: (text: string) => Promise<void>;
}) {
  const config = DECISION[decision];
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (config.needsReason && text.trim().length < VERIFICATION_REASON_MIN) {
      setError(
        `Give a reason of at least ${VERIFICATION_REASON_MIN} characters the organisation can act on.`,
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(text.trim());
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The decision could not be recorded.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalContent
      size="md"
      title={config.title}
      description={
        decision === 'approve'
          ? 'This marks the problem resolved and completes the project. The citizen who reported it is told.'
          : 'The organisation sees your reason. The problem stays in progress and the evidence stays on record.'
      }
      footer={
        <>
          <ModalClose asChild>
            <Button variant="secondary" size="sm">
              Cancel
            </Button>
          </ModalClose>
          <Button
            size="sm"
            variant={
              config.tone === 'danger'
                ? 'danger'
                : config.tone === 'secondary'
                  ? 'secondary'
                  : 'primary'
            }
            loading={pending}
            onClick={() => void submit()}
          >
            {config.action}
          </Button>
        </>
      }
    >
      <Field
        label={config.needsReason ? 'Reason' : 'Verification note (optional)'}
        required={config.needsReason}
        error={error ?? undefined}
        hint={
          config.needsReason
            ? 'Shared with the organisation.'
            : 'Shared with the organisation, e.g. how you verified it.'
        }
      >
        <Textarea
          rows={4}
          value={text}
          maxLength={VERIFICATION_REASON_MAX}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
    </ModalContent>
  );
}
