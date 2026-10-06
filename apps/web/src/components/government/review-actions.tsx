'use client';

import { CheckCircle2, PlayCircle, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  REVIEW_NOTE_MAX_LENGTH,
  REVIEW_NOTE_REQUIRED,
  type ProblemStatus,
} from '@samadhaan/shared';
import { ProblemStatusBadge } from '@/components/problems/problem-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { PROBLEM_STATUS_DISPLAY } from '@/lib/domain-display';
import { TRANSITION_ACTION_LABEL } from '@/lib/government';
import { changeProblemStatus } from '@/services/government.service';

const ICON: Record<string, typeof CheckCircle2> = {
  UNDER_REVIEW: PlayCircle,
  VERIFIED: CheckCircle2,
  REJECTED: XCircle,
};

/**
 * The review decision for one problem.
 *
 * Offers exactly the transitions the API reported as allowed from the current
 * status — and the API checks again. Every decision is confirmed in a dialog,
 * may carry a note (required to reject), and is written to the audit log.
 * The reporter is notified; the note is not shown to them.
 */
export function ReviewActions({
  slug,
  publicId,
  status,
  allowed,
}: {
  slug: string;
  publicId: string;
  status: ProblemStatus;
  allowed: ProblemStatus[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [target, setTarget] = useState<ProblemStatus | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const noteRequired = target !== null && REVIEW_NOTE_REQUIRED.includes(target);

  async function confirm() {
    if (!target) return;
    if (noteRequired && note.trim().length === 0) {
      setError('Give a reason. The reporter is told their report was not accepted.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await changeProblemStatus(slug, publicId, target, note.trim() || undefined);
      toast({
        tone: 'success',
        title: `${publicId} is now ${PROBLEM_STATUS_DISPLAY[target].label.toLowerCase()}`,
        description: 'Recorded in the audit trail. The reporter has been notified.',
      });
      setTarget(null);
      setNote('');
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
      <CardHeader title="Review decision" description="Recorded in the audit trail." />
      <CardBody className="space-y-3">
        <p className="flex items-center gap-2 type-body-sm text-ink-muted">
          Current status <ProblemStatusBadge status={status} />
        </p>

        {allowed.length === 0 ? (
          <p className="type-body-sm text-ink-muted">
            {status === 'VERIFIED' ? (
              <>
                Verified. The next step is to{' '}
                <a
                  href="#allocation"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  allocate it to an organisation
                </a>
                .
              </>
            ) : status === 'IN_PROGRESS' ? (
              'In progress with the organisation that accepted the allocation.'
            ) : (
              'No review decision applies at this status.'
            )}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allowed.map((next) => {
              const Icon = ICON[next] ?? CheckCircle2;
              return (
                <Button
                  key={next}
                  variant={next === 'REJECTED' ? 'secondary' : 'primary'}
                  size="sm"
                  leadingIcon={<Icon />}
                  onClick={() => {
                    setTarget(next);
                    setError(null);
                  }}
                >
                  {TRANSITION_ACTION_LABEL[next] ?? PROBLEM_STATUS_DISPLAY[next].label}
                </Button>
              );
            })}
          </div>
        )}
      </CardBody>

      <Modal open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <ModalContent
          title={
            target
              ? `${TRANSITION_ACTION_LABEL[target] ?? 'Update'} ${publicId}?`
              : 'Update'
          }
          description={
            target === 'REJECTED'
              ? 'The report will be closed as not a civic problem for action. Give the reason for the record.'
              : target === 'VERIFIED'
                ? 'You are confirming this is a genuine civic problem in your jurisdiction.'
                : 'The reporter will see that their report is being reviewed.'
          }
          footer={
            <>
              <ModalClose asChild>
                <Button variant="secondary" size="sm">
                  Cancel
                </Button>
              </ModalClose>
              <Button
                variant={target === 'REJECTED' ? 'danger' : 'primary'}
                size="sm"
                loading={pending}
                onClick={() => void confirm()}
              >
                {target ? (TRANSITION_ACTION_LABEL[target] ?? 'Confirm') : 'Confirm'}
              </Button>
            </>
          }
        >
          <Field
            label={noteRequired ? 'Reason (required)' : 'Review note (optional)'}
            hint="Kept in the audit trail for your office. Not shown to the reporter."
            error={error ?? undefined}
          >
            <Textarea
              rows={3}
              value={note}
              maxLength={REVIEW_NOTE_MAX_LENGTH}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </ModalContent>
      </Modal>
    </Card>
  );
}
