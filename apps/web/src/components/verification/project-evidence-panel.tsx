'use client';

import { Plus, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  EvidenceView,
  ProjectVerificationView,
  VerificationTimelineEntry,
} from '@samadhaan/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { REQUEST_STATUS_DISPLAY } from '@/lib/verification';
import {
  analyzeEvidence,
  fetchProjectVerification,
  requestVerification,
  withdrawEvidence,
} from '@/services/verification.service';
import { MissingEvidence } from './ai-verification-review';
import { EvidenceCard } from './evidence-card';
import { EvidenceUploadDialog } from './evidence-upload-dialog';

/**
 * Resolution evidence for a project (Prompt 22). The organisation submits
 * evidence and, when ready, asks the allocating office to verify; the office
 * decides. The AI review beside each item is advisory.
 */
export function ProjectEvidencePanel({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [view, setView] = useState<ProjectVerificationView | null>(null);
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [replacing, setReplacing] = useState<EvidenceView | null>(null);
  const [note, setNote] = useState('');
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(
    () =>
      fetchProjectVerification(projectId)
        .then((next) => {
          setView(next);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [projectId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // Follow background AI reviews until they finish.
  const running = view?.evidence.some(
    (e) => e.aiStatus === 'PENDING' || e.aiStatus === 'PROCESSING',
  );
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [running, load]);

  async function act(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast({ tone: 'success', title: done });
    } catch (caught) {
      toast({
        tone: 'danger',
        title: 'That did not work',
        description: caught instanceof ApiError ? caught.message : undefined,
      });
    }
    void load();
  }

  if (failed && !view) {
    return (
      <Card id="evidence">
        <ErrorState
          size="sm"
          title="Evidence could not be loaded"
          onRetry={() => void load()}
        />
      </Card>
    );
  }
  if (!view) {
    return (
      <Card id="evidence" aria-busy="true">
        <CardBody>
          <p className="type-body-sm text-ink-muted">Loading evidence…</p>
        </CardBody>
      </Card>
    );
  }

  const returned = view.evidence.filter(
    (e) => e.status === 'NEEDS_MORE_EVIDENCE' || e.status === 'REJECTED',
  );
  return (
    <Card id="evidence" className="scroll-mt-24">
      <CardHeader
        title="Resolution evidence"
        description="AI assists verification but does not prove a problem is permanently fixed. The government office decides."
        action={
          view.canSubmitEvidence ? (
            <Button size="sm" leadingIcon={<Plus />} onClick={() => setUploading(true)}>
              Submit evidence
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-5">
        {view.problemStatus === 'RESOLVED' && (
          <Alert tone="success" title="Resolution verified">
            The government office approved the resolution. The project is complete.
          </Alert>
        )}

        {view.request && (
          <div className="flex flex-wrap items-center gap-2 rounded-control bg-primary-soft/40 p-3">
            <Badge tone={REQUEST_STATUS_DISPLAY.PENDING.tone}>
              {REQUEST_STATUS_DISPLAY.PENDING.label}
            </Badge>
            <span className="type-caption text-ink-muted">
              Requested by {view.request.requestedBy}{' '}
              {formatRelativeTime(view.request.createdAt)} · {view.request.evidenceCount}{' '}
              evidence item{view.request.evidenceCount === 1 ? '' : 's'} with{' '}
              {view.request.governmentName}
            </span>
          </div>
        )}

        {view.problemStatus !== 'RESOLVED' &&
          !view.request &&
          view.evidence.some((e) => e.status !== 'DRAFT') && (
            <section
              aria-labelledby="request-verification"
              className="space-y-2 rounded-control border border-border p-3"
            >
              <h3 id="request-verification" className="type-label text-ink">
                Request government verification
              </h3>
              {view.canRequestVerification ? (
                <>
                  <Field label="Note for the office (optional)">
                    <Textarea
                      rows={2}
                      maxLength={1000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field>
                  <Button
                    size="sm"
                    leadingIcon={<Send />}
                    loading={requesting}
                    onClick={async () => {
                      setRequesting(true);
                      await act(
                        () => requestVerification(projectId, note.trim() || undefined),
                        'Verification requested',
                      );
                      setNote('');
                      setRequesting(false);
                    }}
                  >
                    Request verification
                  </Button>
                </>
              ) : (
                <ul className="list-disc pl-5 type-caption text-ink-muted">
                  {view.requestBlockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

        {returned.length > 0 && view.canSubmitEvidence && (
          <p className="type-caption text-ink-muted">
            Returned evidence stays on record. Submit a new version, or add more evidence,
            then request verification again.
          </p>
        )}

        {view.evidence.length === 0 ? (
          <p className="type-body-sm text-ink-muted">
            No evidence yet. When the work is done, submit photos (before and after),
            documents or a video.
          </p>
        ) : (
          <div className="space-y-3">
            {view.evidence.map((e) => (
              <div key={e.id} className="space-y-1">
                <EvidenceCard
                  evidence={e}
                  onWithdraw={() =>
                    void act(() => withdrawEvidence(e.id), 'Evidence withdrawn')
                  }
                  onAnalyze={() =>
                    void act(() => analyzeEvidence(e.id), 'AI review requested')
                  }
                />
                {view.canSubmitEvidence &&
                  !e.replacedByEvidenceId &&
                  ['NEEDS_MORE_EVIDENCE', 'REJECTED', 'AI_REVIEWED'].includes(
                    e.status,
                  ) && (
                    <Button size="sm" variant="link" onClick={() => setReplacing(e)}>
                      Submit a new version of this evidence
                    </Button>
                  )}
              </div>
            ))}
          </div>
        )}

        <MissingEvidence items={view.missingEvidence} />
        <VerificationTimeline entries={view.timeline} />
      </CardBody>

      <EvidenceUploadDialog
        projectId={projectId}
        open={uploading || replacing !== null}
        replaces={replacing}
        onClose={() => {
          setUploading(false);
          setReplacing(null);
        }}
        onSubmitted={() => {
          toast({ tone: 'success', title: 'Evidence submitted — AI review running' });
          void load();
        }}
      />
    </Card>
  );
}

export function VerificationTimeline({
  entries,
}: {
  entries: VerificationTimelineEntry[];
}) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="verification-history">
      <h3 id="verification-history" className="type-label text-ink">
        Verification history
      </h3>
      <ol className="mt-1.5 space-y-1">
        {entries.map((entry) => (
          <li key={entry.id} className="type-caption text-ink-muted">
            <time
              dateTime={entry.createdAt}
              title={formatDateTime(entry.createdAt)}
              className="text-ink-subtle"
            >
              {formatDateTime(entry.createdAt)}
            </time>{' '}
            — <span className="text-ink">{entry.text}</span>
            {entry.actor.name
              ? ` · ${entry.actor.name}`
              : entry.actor.side === 'SYSTEM'
                ? ' · automatic'
                : ''}
          </li>
        ))}
      </ol>
    </section>
  );
}
