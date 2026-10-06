'use client';

import { AlertTriangle, Check, Info, MapPin, Search, Send, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ALLOCATION_NOTE_MAX_LENGTH,
  type AllocationCandidate,
  type GovernmentAllocationPanel as PanelData,
  type GovernmentAllocationView,
} from '@samadhaan/shared';
import { RelevanceIndicator } from '@/components/matching/relevance-indicator';
import { VerificationBadge } from '@/components/profile/verification-badge';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { INELIGIBILITY_LABEL } from '@/lib/allocation';
import { ApiError } from '@/lib/api-error';
import { formatDateTime } from '@/lib/format';
import { describeReason } from '@/lib/matching';
import { ORGANIZATION_TYPE_LABEL } from '@/lib/workspace';
import {
  cancelAllocation,
  createAllocation,
  searchAllocationCandidates,
} from '@/services/allocation.service';
import { AllocationStatusBadge } from './allocation-status-badge';
import { AllocationTimeline } from './allocation-timeline';

export const ALLOCATION_NOTICE =
  'This action sends an official allocation request to the selected organization.';

/**
 * Allocation of a verified problem, for a government official.
 *
 * Matching's recommendations are shown as decision support, and any other
 * eligible organisation can be found by name. Nothing is allocated without an
 * official choosing an organisation and confirming in a dialog — there is no
 * "allocate the top match" control. The API re-checks every rule: the
 * problem's status and jurisdiction, the organisation's eligibility, and that
 * no other allocation is active.
 */
export function GovernmentAllocationPanel({
  slug,
  publicId,
  panel,
}: {
  slug: string;
  publicId: string;
  panel: PanelData;
}) {
  const [selected, setSelected] = useState<AllocationCandidate | null>(null);
  const [cancelling, setCancelling] = useState<GovernmentAllocationView | null>(null);
  const past = panel.history.filter((entry) => entry.id !== panel.active?.id);

  return (
    <section
      id="allocation"
      aria-labelledby="allocation-heading"
      className="scroll-mt-24"
    >
      <Card>
        <CardHeader
          title={<span id="allocation-heading">Allocation</span>}
          description="Assign this problem to an organisation that can act on it."
        />
        <CardBody className="space-y-6">
          {panel.active ? (
            <ActiveAllocation
              allocation={panel.active}
              onCancel={() => setCancelling(panel.active)}
            />
          ) : panel.blockedReason === 'NOT_VERIFIED' ? (
            <p className="type-body-sm text-ink-muted">
              Only verified problems can be allocated. Verify this report first.
            </p>
          ) : null}

          {panel.canAllocate && (
            <Candidates
              slug={slug}
              publicId={publicId}
              recommended={panel.candidates}
              onSelect={setSelected}
            />
          )}

          {panel.history.length > 0 && (
            <div className="space-y-4">
              <h3 className="type-label text-ink">Allocation history</h3>
              <AllocationTimeline
                verifiedAt={panel.verifiedAt}
                allocations={[...panel.history].reverse().map((entry) => ({
                  ...entry,
                  organizationName: entry.organization.name,
                }))}
              />
              {past.length > 0 && (
                <ul className="space-y-2">
                  {past.map((entry) => (
                    <PastAllocation key={entry.id} allocation={entry} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <AllocateDialog
        slug={slug}
        publicId={publicId}
        candidate={selected}
        onClose={() => setSelected(null)}
      />
      <CancelDialog
        slug={slug}
        allocation={cancelling}
        onClose={() => setCancelling(null)}
      />
    </section>
  );
}

function ActiveAllocation({
  allocation,
  onCancel,
}: {
  allocation: GovernmentAllocationView;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-card border border-border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar
          name={allocation.organization.name}
          src={allocation.organization.logoUrl ?? undefined}
          size="md"
          className="rounded-control"
        />
        <div className="min-w-0 flex-1">
          <p className="type-body-sm font-semibold text-ink">
            {allocation.organization.name}
          </p>
          <p className="type-caption text-ink-subtle">
            {ORGANIZATION_TYPE_LABEL[allocation.organization.type]} · Allocated{' '}
            {formatDateTime(allocation.proposedAt)}
            {allocation.allocatedBy.name && ` by ${allocation.allocatedBy.name}`}
          </p>
        </div>
        <AllocationStatusBadge status={allocation.status} />
      </div>

      <dl className="mt-4 space-y-3 type-body-sm">
        {allocation.instructions && (
          <Note label="Instructions (shared with the organisation)">
            {allocation.instructions}
          </Note>
        )}
        {allocation.internalReason && (
          <Note label="Internal reason (your office only)">
            {allocation.internalReason}
          </Note>
        )}
        {allocation.responseNote && (
          <Note label="Organisation's note">{allocation.responseNote}</Note>
        )}
      </dl>

      {allocation.status === 'PENDING' && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="type-caption text-ink-muted">
            Waiting for the organisation&rsquo;s owners or admins to respond.
          </p>
          {allocation.ownedByThisOffice && (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Undo2 />}
              onClick={onCancel}
            >
              Withdraw allocation
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PastAllocation({ allocation }: { allocation: GovernmentAllocationView }) {
  const reason = allocation.declineReason ?? allocation.cancellationReason;
  return (
    <li className="rounded-control border border-border-subtle px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="type-body-sm font-medium text-ink">
          {allocation.organization.name}
        </span>
        <AllocationStatusBadge status={allocation.status} size="sm" />
      </div>
      {reason && (
        <p className="mt-1 type-caption text-ink-muted">
          {allocation.status === 'DECLINED' ? 'Reason: ' : 'Withdrawn: '}
          {reason}
        </p>
      )}
    </li>
  );
}

function Note({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <dt className="type-caption font-medium text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-ink-muted">{children}</dd>
    </div>
  );
}

function Candidates({
  slug,
  publicId,
  recommended,
  onSelect,
}: {
  slug: string;
  publicId: string;
  recommended: AllocationCandidate[];
  onSelect: (candidate: AllocationCandidate) => void;
}) {
  const [query, setQuery] = useState('');
  // Keyed by the query they answer, so a stale answer is never shown for a
  // newer query, and clearing the box needs no state reset.
  const [answer, setAnswer] = useState<{
    query: string;
    items: AllocationCandidate[] | null;
    failed: boolean;
  } | null>(null);
  const trimmed = query.trim();
  const active = trimmed.length >= 2;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchAllocationCandidates(slug, publicId, trimmed, controller.signal)
        .then((items) => setAnswer({ query: trimmed, items, failed: false }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn('candidate search failed', error);
          setAnswer({ query: trimmed, items: null, failed: true });
        });
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [slug, publicId, trimmed, active]);

  const current = active && answer?.query === trimmed ? answer : null;
  const searching = active && current === null;
  const searchError = current?.failed ?? false;
  const results = active ? (current?.items ?? []) : null;
  const shown = results ?? recommended;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-card border border-info-border bg-info-soft px-4 py-3 type-body-sm text-ink">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
        <p>
          Recommendations are AI-assisted suggestions. Final allocation is made by an
          authorized government official.
        </p>
      </div>

      <Field
        label="Find any organisation"
        hint="Search by name to allocate to an organisation that was not recommended."
      >
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Organisation name"
          leadingIcon={<Search />}
          maxLength={80}
        />
      </Field>

      <div aria-live="polite" className="space-y-3">
        <h3 className="type-label text-ink">
          {results ? `Organisations matching “${trimmed}”` : 'Recommended organisations'}
          {searching && (
            <Spinner className="ml-2 inline-block size-3.5" label="Searching" />
          )}
        </h3>
        {searchError ? (
          <p className="type-body-sm text-danger">Search failed. Try again.</p>
        ) : searching ? null : shown.length === 0 ? (
          <p className="type-body-sm text-ink-muted">
            {results
              ? 'No NGO, university or industry organisation has that name.'
              : 'Matching has not recommended any organisation for this problem. Search by name above.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((candidate) => (
              <CandidateRow
                key={candidate.organization.id}
                candidate={candidate}
                onSelect={() => onSelect(candidate)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CandidateRow({
  candidate,
  onSelect,
}: {
  candidate: AllocationCandidate;
  onSelect: () => void;
}) {
  const { organization, match } = candidate;
  const place = [organization.location.city, organization.location.state]
    .filter(Boolean)
    .join(', ');

  return (
    <li className="rounded-card border border-border p-3">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar
          name={organization.name}
          src={organization.logoUrl ?? undefined}
          size="sm"
          className="rounded-control"
        />
        <div className="min-w-0 flex-1">
          <p className="type-body-sm font-semibold text-ink">{organization.name}</p>
          <p className="flex flex-wrap items-center gap-x-2 type-caption text-ink-subtle">
            <span>{ORGANIZATION_TYPE_LABEL[organization.type]}</span>
            {place && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" aria-hidden="true" />
                {place}
              </span>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <VerificationBadge status={organization.verificationStatus} size="sm" />
            {candidate.previouslyDeclined && (
              <Badge tone="warning" size="sm" icon={<AlertTriangle />}>
                Declined this problem before
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          leadingIcon={<Send />}
          disabled={!candidate.eligible}
          onClick={onSelect}
          aria-label={`Allocate to ${organization.name}`}
        >
          Allocate
        </Button>
      </div>

      {match && (
        <div className="mt-3 space-y-2 border-t border-border-subtle pt-3">
          <RelevanceIndicator relevance={match.relevance} />
          {match.reasons.length > 0 && (
            <ul className="space-y-1 type-caption text-ink-muted">
              {match.reasons.slice(0, 2).map((reason) => (
                <li key={reason.code} className="flex items-start gap-1.5">
                  <Check
                    className="mt-0.5 size-3 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  {describeReason(reason, {
                    perspective: 'citizen',
                    type: organization.type,
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!candidate.eligible && candidate.ineligibleReason && (
        <p className="mt-2 type-caption text-ink-muted">
          Cannot be allocated:{' '}
          {INELIGIBILITY_LABEL[candidate.ineligibleReason].toLowerCase()}.
        </p>
      )}
    </li>
  );
}

function AllocateDialog({
  slug,
  publicId,
  candidate,
  onClose,
}: {
  slug: string;
  publicId: string;
  candidate: AllocationCandidate | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [instructions, setInstructions] = useState('');
  const [internalReason, setInternalReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setInstructions('');
    setInternalReason('');
    setError(null);
    onClose();
  }

  async function confirm() {
    if (!candidate) return;
    setPending(true);
    setError(null);
    try {
      await createAllocation(slug, publicId, {
        organizationId: candidate.organization.id,
        instructions: instructions.trim() || undefined,
        internalReason: internalReason.trim() || undefined,
      });
      toast({
        tone: 'success',
        title: `Allocation request sent to ${candidate.organization.name}`,
        description: 'Its owners and admins have been notified.',
      });
      close();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Check your connection and try again.',
      );
      // Someone else may have allocated it meanwhile; show the current state.
      if (caught instanceof ApiError && caught.status === 409) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={candidate !== null} onOpenChange={(open) => !open && close()}>
      <ModalContent
        size="md"
        title={
          candidate
            ? `Allocate ${publicId} to ${candidate.organization.name}?`
            : 'Allocate'
        }
        description={ALLOCATION_NOTICE}
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </ModalClose>
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Send />}
              loading={pending}
              onClick={() => void confirm()}
            >
              Send allocation request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Instructions (optional)" hint="Shared with the organisation.">
            <Textarea
              rows={3}
              value={instructions}
              maxLength={ALLOCATION_NOTE_MAX_LENGTH}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </Field>
          <Field
            label="Internal reason (optional)"
            hint="Kept by your office. Not shown to the organisation or the public."
            error={error ?? undefined}
          >
            <Textarea
              rows={2}
              value={internalReason}
              maxLength={ALLOCATION_NOTE_MAX_LENGTH}
              onChange={(event) => setInternalReason(event.target.value)}
            />
          </Field>
        </div>
      </ModalContent>
    </Modal>
  );
}

function CancelDialog({
  slug,
  allocation,
  onClose,
}: {
  slug: string;
  allocation: GovernmentAllocationView | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setReason('');
    setError(null);
    onClose();
  }

  async function confirm() {
    if (!allocation) return;
    setPending(true);
    setError(null);
    try {
      await cancelAllocation(slug, allocation.id, reason.trim() || undefined);
      toast({
        tone: 'success',
        title: 'Allocation withdrawn',
        description: `${allocation.organization.name} has been told. You can allocate again.`,
      });
      close();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Check your connection and try again.',
      );
      if (caught instanceof ApiError && caught.status === 409) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={allocation !== null} onOpenChange={(open) => !open && close()}>
      <ModalContent
        size="md"
        title="Withdraw this allocation?"
        description={
          allocation
            ? `${allocation.organization.name} will be told the request was withdrawn. The problem stays verified and can be allocated again.`
            : undefined
        }
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary" size="sm">
                Keep allocation
              </Button>
            </ModalClose>
            <Button
              variant="danger"
              size="sm"
              loading={pending}
              onClick={() => void confirm()}
            >
              Withdraw
            </Button>
          </>
        }
      >
        <Field
          label="Reason (optional)"
          hint="Kept in your office's records."
          error={error ?? undefined}
        >
          <Textarea
            rows={2}
            value={reason}
            maxLength={ALLOCATION_NOTE_MAX_LENGTH}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </ModalContent>
    </Modal>
  );
}
