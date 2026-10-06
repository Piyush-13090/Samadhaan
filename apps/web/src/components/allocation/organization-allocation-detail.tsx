'use client';

import {
  CheckCircle2,
  ExternalLink,
  Heart,
  Landmark,
  MapPin,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ALLOCATION_NOTE_MAX_LENGTH,
  type OrganizationAllocationDetail as Detail,
} from '@samadhaan/shared';
import { CategoryBadge } from '@/components/problems/category-badge';
import { ProblemStatusBadge } from '@/components/problems/problem-status-badge';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { DECLINE_REASON_EXAMPLES, allocationPath } from '@/lib/allocation';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatNumber } from '@/lib/format';
import { acceptAllocation, declineAllocation } from '@/services/allocation.service';
import { AllocationStatusBadge } from './allocation-status-badge';
import { AllocationTimeline } from './allocation-timeline';

type Decision = 'accept' | 'decline';

/**
 * One allocation request, as an organisation member sees it.
 *
 * Owners and admins can accept or decline while it is pending; everyone else
 * reads. The API decides both — `canRespond` only hides buttons it would
 * refuse. If another member or the office acts first, the conflict message
 * says so and the page reloads to show what happened.
 */
export function OrganizationAllocationDetail({
  slug,
  allocation,
}: {
  slug: string;
  allocation: Detail;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { problem } = allocation;
  const place = [problem.address ?? problem.area, problem.city, problem.state]
    .filter(Boolean)
    .join(', ');

  function close() {
    setDecision(null);
    setText('');
    setError(null);
  }

  async function confirm() {
    if (!decision) return;
    const value = text.trim();
    if (decision === 'decline' && value.length < 3) {
      setError(
        'Give a reason for declining. The government office reads it to reallocate.',
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (decision === 'accept') {
        await acceptAllocation(slug, allocation.id, value || undefined);
        toast({
          tone: 'success',
          title: `${problem.publicId} accepted`,
          description: 'The problem is now in progress with your organisation.',
        });
      } else {
        await declineAllocation(slug, allocation.id, value);
        toast({
          tone: 'success',
          title: `${problem.publicId} declined`,
          description: 'The government office has been told and can reallocate it.',
        });
      }
      close();
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setConflict(caught.message);
        close();
        router.refresh();
      } else {
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Check your connection and try again.',
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={allocationPath(slug)}
          className="type-caption font-medium text-primary underline-offset-2 hover:underline"
        >
          ← Allocations
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono type-body-sm text-ink-subtle">
            {problem.publicId}
          </span>
          <AllocationStatusBadge status={allocation.status} />
          <ProblemStatusBadge status={problem.status} />
          <SeverityBadge severity={problem.severity} />
        </div>
        <h1 className="mt-2 type-h1 text-ink">{problem.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 type-body-sm text-ink-muted">
          <CategoryBadge category={problem.category} size="sm" />
          {problem.subcategory && <span>→ {problem.subcategory}</span>}
          {place && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden="true" />
              {place}
            </span>
          )}
        </p>
      </header>

      {conflict && (
        <Alert tone="warning" title="Already decided">
          {conflict}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader
              title="Allocation request"
              icon={<Landmark className="size-4" />}
              description={`From ${allocation.government.name} · ${formatDateTime(allocation.proposedAt)}`}
            />
            <CardBody className="space-y-4">
              {allocation.instructions ? (
                <div>
                  <p className="type-caption font-medium text-ink-subtle">Instructions</p>
                  <p className="mt-1 whitespace-pre-line type-body-sm text-ink">
                    {allocation.instructions}
                  </p>
                </div>
              ) : (
                <p className="type-body-sm text-ink-muted">
                  The office did not add instructions.
                </p>
              )}

              {allocation.status === 'PENDING' &&
                (allocation.canRespond ? (
                  <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
                    <Button
                      variant="primary"
                      size="sm"
                      leadingIcon={<CheckCircle2 />}
                      onClick={() => setDecision('accept')}
                    >
                      Accept
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      leadingIcon={<XCircle />}
                      onClick={() => setDecision('decline')}
                    >
                      Decline
                    </Button>
                  </div>
                ) : (
                  <p className="border-t border-border-subtle pt-4 type-body-sm text-ink-muted">
                    An owner or admin of your organisation can accept or decline this
                    request.
                  </p>
                ))}

              {allocation.responseNote && (
                <div>
                  <p className="type-caption font-medium text-ink-subtle">Your note</p>
                  <p className="mt-1 whitespace-pre-line type-body-sm text-ink-muted">
                    {allocation.responseNote}
                  </p>
                </div>
              )}
              {allocation.declineReason && (
                <div>
                  <p className="type-caption font-medium text-ink-subtle">
                    Your reason for declining
                  </p>
                  <p className="mt-1 whitespace-pre-line type-body-sm text-ink-muted">
                    {allocation.declineReason}
                  </p>
                </div>
              )}
              {allocation.status === 'CANCELLED' && (
                <p className="type-body-sm text-ink-muted">
                  The government office withdrew this request
                  {allocation.cancelledAt &&
                    ` on ${formatDateTime(allocation.cancelledAt)}`}
                  .
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="The problem" />
            <CardBody className="space-y-4">
              <p className="whitespace-pre-line type-body text-ink-muted">
                {problem.description}
              </p>
              <dl className="grid gap-x-6 gap-y-2 type-body-sm sm:grid-cols-2">
                <div>
                  <dt className="type-caption text-ink-subtle">Reported</dt>
                  <dd className="text-ink">{formatDateTime(problem.reportedAt)}</dd>
                </div>
                <div>
                  <dt className="type-caption text-ink-subtle">Community support</dt>
                  <dd className="inline-flex items-center gap-1 text-ink">
                    <Heart className="size-3.5 text-danger" aria-hidden="true" />
                    {formatNumber(problem.voteCount)}
                  </dd>
                </div>
              </dl>
              <Link
                href={`/problems/${encodeURIComponent(problem.publicId)}`}
                className="inline-flex items-center gap-1 type-body-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                Open the public problem page
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </Link>
            </CardBody>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader title="Timeline" />
          <CardBody>
            <AllocationTimeline
              verifiedAt={null}
              allocations={[
                {
                  ...allocation,
                  organizationName: 'your organisation',
                },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <Modal open={decision !== null} onOpenChange={(open) => !open && close()}>
        <ModalContent
          size="md"
          title={
            decision === 'accept'
              ? `Accept ${problem.publicId}?`
              : `Decline ${problem.publicId}?`
          }
          description={
            decision === 'accept'
              ? `Your organisation takes responsibility for this problem. It moves to In progress, and ${allocation.government.name} is notified.`
              : `${allocation.government.name} is notified and can allocate the problem to another organisation. The problem stays verified.`
          }
          footer={
            <>
              <ModalClose asChild>
                <Button variant="secondary" size="sm">
                  Cancel
                </Button>
              </ModalClose>
              <Button
                variant={decision === 'decline' ? 'danger' : 'primary'}
                size="sm"
                loading={pending}
                onClick={() => void confirm()}
              >
                {decision === 'accept' ? 'Accept allocation' : 'Decline allocation'}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field
              label={decision === 'decline' ? 'Reason for declining' : 'Note (optional)'}
              required={decision === 'decline'}
              hint={
                decision === 'decline'
                  ? 'Shared with the government office. Not shown publicly.'
                  : 'Shared with the government office.'
              }
              error={error ?? undefined}
            >
              <Textarea
                rows={3}
                value={text}
                maxLength={ALLOCATION_NOTE_MAX_LENGTH}
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
            {decision === 'decline' && (
              <div>
                <p className="type-caption text-ink-subtle">Common reasons</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {DECLINE_REASON_EXAMPLES.map((example) => (
                    <Button
                      key={example}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setText(example)}
                    >
                      {example}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ModalContent>
      </Modal>
    </div>
  );
}
