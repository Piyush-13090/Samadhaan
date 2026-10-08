'use client';

import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Gavel,
  History,
  Info,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  PRIORITY_OVERRIDE_REASON_MAX,
  PRIORITY_OVERRIDE_REASON_MIN,
  PRIORITY_TIERS,
  type GovernmentPriorityView,
  type PriorityAssessmentView,
  type PriorityReason,
  type PriorityTier,
} from '@samadhaan/shared';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { NativeSelect } from '@/components/project/native-select';
import { PriorityBadge } from '@/components/problems/priority-badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ErrorState } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import { PRIORITY_TIER_DISPLAY } from '@/lib/domain-display';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import {
  fetchPriority,
  overridePriority,
  recalculatePriority,
  removePriorityOverride,
} from '@/services/government.service';

const REASON_ICON = {
  driver: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
} as const;

const AI_STATUS_TEXT: Record<string, string> = {
  COMPLETED: 'AI-assisted features from',
  REUSED: 'AI-assisted features (unchanged report) from',
  UNAVAILABLE: 'No AI model ran — AI-assisted features unavailable',
  FAILED: 'The AI service was unavailable — scored without AI-assisted features',
  DISABLED: 'AI-assisted features are switched off',
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The priority engine's assessment of one problem, for officials (Prompt 21).
 *
 * Advisory and explainable: the tier, the score, why, how much to trust it
 * (confidence and data completeness), the full breakdown, the history of
 * changes, and supporting civic guidance — and, separately, an official's
 * override with its reason. An override never edits the AI assessment; both
 * stay visible.
 */
export function PriorityInsightCard({
  slug,
  publicId,
}: {
  slug: string;
  publicId: string;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<GovernmentPriorityView | null>(null);
  const [failed, setFailed] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(
    () =>
      fetchPriority(slug, publicId)
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

  async function recalculate() {
    setRecalculating(true);
    try {
      setView(await recalculatePriority(slug, publicId));
      toast({ tone: 'success', title: 'Priority recalculated' });
    } catch (caught) {
      toast({
        tone: 'danger',
        title: 'Not recalculated',
        description: caught instanceof ApiError ? caught.message : undefined,
      });
    } finally {
      setRecalculating(false);
    }
  }

  if (failed && !view) {
    return (
      <Card id="priority">
        <ErrorState
          size="sm"
          title="Priority could not be loaded"
          onRetry={() => void load()}
        />
      </Card>
    );
  }
  if (!view) {
    return (
      <Card id="priority" aria-busy="true">
        <CardBody>
          <p className="type-body-sm text-ink-muted">Loading priority…</p>
        </CardBody>
      </Card>
    );
  }

  const assessment = view.assessment;
  return (
    <Card id="priority" className="scroll-mt-24 border-ai-border">
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 type-h4 text-ink">
              <AiSparkIcon className="size-4 text-ai" />
              Priority
            </h2>
            <p className="type-caption text-ink-subtle">
              Advisory. An explainable estimate to order the review — officials decide.
            </p>
          </div>
          {view.canOverride && (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<RefreshCw />}
              loading={recalculating}
              onClick={() => void recalculate()}
            >
              Recalculate
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <PriorityBadge
            tier={view.effective.tier}
            overridden={view.effective.source === 'OVERRIDE'}
            provisional={assessment?.provisional}
          />
          {assessment && (
            <span className="type-body-sm text-ink">
              <span className="sr-only">AI priority score </span>
              <span className="tabular text-lg font-semibold">
                {Math.round(assessment.score)}
              </span>
              <span className="text-ink-subtle">/100</span>
              {view.override && (
                <span className="ml-2 type-caption text-ink-muted">
                  AI estimate: {PRIORITY_TIER_DISPLAY[assessment.tier].label}
                </span>
              )}
            </span>
          )}
        </div>

        {view.override && (
          <OverrideNotice
            view={view}
            onRemove={async (reason) => {
              try {
                setView(await removePriorityOverride(slug, publicId, reason));
                toast({ tone: 'success', title: 'Override removed' });
              } catch (caught) {
                toast({
                  tone: 'danger',
                  title: 'Override not removed',
                  description: caught instanceof ApiError ? caught.message : undefined,
                });
              }
            }}
          />
        )}

        {assessment ? (
          <Assessment
            assessment={assessment}
            showBreakdown={showBreakdown}
            onToggle={() => setShowBreakdown((v) => !v)}
          />
        ) : (
          <p className="rounded-control bg-subtle/60 p-3 type-body-sm text-ink-muted">
            Not assessed yet. Assessment runs in the background after the AI analysis; you
            can also recalculate now.
          </p>
        )}

        {view.history.length > 1 && (
          <section aria-labelledby="priority-history">
            <h3
              id="priority-history"
              className="flex items-center gap-1.5 type-label text-ink"
            >
              <History className="size-4 text-ink-subtle" aria-hidden="true" /> How it
              changed
            </h3>
            <ol className="mt-1.5 space-y-1.5">
              {view.history.map((entry) => (
                <li key={entry.id} className="type-caption text-ink-muted">
                  <span className="text-ink">
                    {PRIORITY_TIER_DISPLAY[entry.tier].label} · {Math.round(entry.score)}
                  </span>{' '}
                  <time
                    dateTime={entry.calculatedAt}
                    title={formatDateTime(entry.calculatedAt)}
                  >
                    {formatRelativeTime(entry.calculatedAt)}
                  </time>
                  {entry.changes.length > 0 && <> — {entry.changes.join(' ')}</>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {view.canOverride &&
          (editing ? (
            <OverrideForm
              initial={view.override}
              onCancel={() => setEditing(false)}
              onSave={async (input) => {
                setView(await overridePriority(slug, publicId, input));
                setEditing(false);
                toast({ tone: 'success', title: 'Priority set' });
              }}
            />
          ) : (
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Gavel />}
              onClick={() => setEditing(true)}
            >
              {view.override ? 'Change the priority you set' : 'Set priority manually'}
            </Button>
          ))}
      </CardBody>
    </Card>
  );
}

function Assessment({
  assessment,
  showBreakdown,
  onToggle,
}: {
  assessment: PriorityAssessmentView;
  showBreakdown: boolean;
  onToggle: () => void;
}) {
  const drivers = assessment.reasons.filter((r) => r.kind === 'driver');
  const others = assessment.reasons.filter((r) => r.kind !== 'driver');
  return (
    <>
      <section aria-labelledby="priority-why">
        <h3 id="priority-why" className="type-label text-ink">
          Why this priority
        </h3>
        {drivers.length === 0 && (
          <p className="mt-1 type-body-sm text-ink-muted">No strong signals so far.</p>
        )}
        <ul className="mt-1.5 space-y-1">
          {[...drivers, ...others].map((reason, index) => (
            <ReasonLine key={index} reason={reason} />
          ))}
        </ul>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Meter label="Confidence" value={assessment.confidence} />
        <Meter label="Data completeness" value={assessment.dataCompleteness} />
      </div>
      {assessment.provisional && (
        <p
          role="status"
          className="flex items-start gap-1.5 type-caption font-medium text-warning"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Provisional — check the evidence before relying on this tier.
        </p>
      )}

      <div>
        <button
          type="button"
          aria-expanded={showBreakdown}
          aria-controls="priority-breakdown"
          onClick={onToggle}
          className="inline-flex items-center gap-1 type-body-sm font-medium text-primary hover:underline"
        >
          <ChevronDown
            className={cn('size-4 transition-transform', showBreakdown && 'rotate-180')}
            aria-hidden="true"
          />
          View priority breakdown
        </button>
        {showBreakdown && (
          <div id="priority-breakdown" className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] type-caption">
              <caption className="sr-only">Priority components</caption>
              <thead className="text-left text-ink-subtle">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Feature
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Value
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Confidence
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Weight
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Points
                  </th>
                </tr>
              </thead>
              <tbody>
                {assessment.breakdown.map((f) => (
                  <tr key={f.key} className="border-t border-border-subtle align-top">
                    <th
                      scope="row"
                      className="py-1.5 pr-2 text-left font-medium text-ink"
                    >
                      {f.label}
                      <span className="block font-normal text-ink-subtle">
                        {f.source}
                      </span>
                      {f.evidence.length > 0 && (
                        <span className="block font-normal text-ink-muted">
                          {f.evidence.join(' · ')}
                        </span>
                      )}
                      {f.note && (
                        <span className="block font-normal text-warning">{f.note}</span>
                      )}
                    </th>
                    <td className="tabular py-1.5 pr-2">
                      {f.available && f.value !== null ? pct(f.value) : 'Unavailable'}
                    </td>
                    <td className="tabular py-1.5 pr-2">
                      {f.available ? pct(f.confidence) : '—'}
                    </td>
                    <td className="tabular py-1.5 pr-2">{pct(f.weight)}</td>
                    <td className="tabular py-1.5">{f.contribution.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {assessment.guidance.length > 0 && (
        <section aria-labelledby="priority-guidance">
          <h3
            id="priority-guidance"
            className="flex items-center gap-1.5 type-label text-ink"
          >
            <BookOpen className="size-4 text-primary" aria-hidden="true" /> Relevant
            guidance
          </h3>
          <p className="type-caption text-ink-subtle">
            Supporting context from the knowledge base. It does not change the score.
          </p>
          <ul className="mt-1 space-y-0.5">
            {assessment.guidance.map((g) => (
              <li key={g.chunkId}>
                <a href={g.href} className="type-body-sm text-primary hover:underline">
                  {g.title}
                  {g.sectionTitle ? ` — ${g.sectionTitle}` : ''}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="type-caption text-ink-subtle">
        Assessed{' '}
        <time
          dateTime={assessment.calculatedAt}
          title={formatDateTime(assessment.calculatedAt)}
        >
          {formatRelativeTime(assessment.calculatedAt)}
        </time>
        {assessment.confirmedAt !== assessment.calculatedAt && (
          <> · unchanged as of {formatRelativeTime(assessment.confirmedAt)}</>
        )}{' '}
        · {assessment.model.scoringModel} {assessment.model.scoringVersion} ·{' '}
        {AI_STATUS_TEXT[assessment.model.aiStatus] ?? assessment.model.aiStatus}
        {assessment.model.aiModel &&
        (assessment.model.aiStatus === 'COMPLETED' ||
          assessment.model.aiStatus === 'REUSED')
          ? ` ${assessment.model.aiModel.name}`
          : ''}
      </p>
    </>
  );
}

function ReasonLine({ reason }: { reason: PriorityReason }) {
  const Icon = REASON_ICON[reason.kind];
  return (
    <li
      className={cn(
        'flex items-start gap-1.5 type-body-sm',
        reason.kind === 'driver'
          ? 'text-ink'
          : reason.kind === 'warning'
            ? 'text-warning'
            : 'text-ink-muted',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          reason.kind === 'driver' && 'text-success',
        )}
        aria-hidden="true"
      />
      <span>
        <span className="sr-only">
          {reason.kind === 'driver'
            ? 'Raises priority: '
            : reason.kind === 'warning'
              ? 'Caution: '
              : ''}
        </span>
        {reason.text}
      </span>
    </li>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="flex justify-between type-caption text-ink-muted">
        <span>{label}</span>
        <span className="tabular text-ink">{pct(value)}</span>
      </p>
      <ProgressBar
        value={value * 100}
        label={label}
        size="sm"
        tone={value < 0.5 ? 'warning' : 'primary'}
      />
    </div>
  );
}

function OverrideNotice({
  view,
  onRemove,
}: {
  view: GovernmentPriorityView;
  onRemove: (reason: string | undefined) => Promise<void>;
}) {
  const override = view.override!;
  const [removing, setRemoving] = useState(false);
  return (
    <section
      aria-labelledby="priority-override"
      className="rounded-control border border-border bg-subtle/50 p-3"
    >
      <h3
        id="priority-override"
        className="flex items-center gap-1.5 type-label text-ink"
      >
        <Gavel className="size-4" aria-hidden="true" /> Set by {override.organizationName}
        : {PRIORITY_TIER_DISPLAY[override.tier].label}
      </h3>
      <p className="mt-1 type-body-sm text-ink">{override.reason}</p>
      <p className="mt-1 type-caption text-ink-subtle">
        {override.overriddenBy ?? 'An official'} ·{' '}
        <time
          dateTime={override.overriddenAt}
          title={formatDateTime(override.overriddenAt)}
        >
          {formatRelativeTime(override.overriddenAt)}
        </time>
        {override.aiTierAtOverride &&
          ` · the AI estimate was ${PRIORITY_TIER_DISPLAY[override.aiTierAtOverride].label.toLowerCase()}${
            override.aiScoreAtOverride !== null
              ? ` (${Math.round(override.aiScoreAtOverride)})`
              : ''
          }`}
        . Visible to government offices covering this problem only.
      </p>
      {view.canOverride && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1"
          loading={removing}
          onClick={async () => {
            setRemoving(true);
            await onRemove(undefined);
            setRemoving(false);
          }}
        >
          Remove override — use the AI estimate
        </Button>
      )}
    </section>
  );
}

function OverrideForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: GovernmentPriorityView['override'];
  onCancel: () => void;
  onSave: (input: { tier: PriorityTier; reason: string }) => Promise<void>;
}) {
  const [tier, setTier] = useState<PriorityTier>(initial?.tier ?? 'HIGH');
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (reason.trim().length < PRIORITY_OVERRIDE_REASON_MIN) {
      setError(`Give a reason of at least ${PRIORITY_OVERRIDE_REASON_MIN} characters.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSave({ tier, reason: reason.trim() });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The priority could not be set.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-control border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="type-caption text-ink-muted">
        Your decision becomes the effective priority. The AI assessment is kept unchanged
        beside it, and the change is recorded in the audit log.
      </p>
      <Field label="Priority">
        <NativeSelect
          value={tier}
          onChange={(event) => setTier(event.target.value as PriorityTier)}
        >
          {PRIORITY_TIERS.map((t) => (
            <option key={t} value={t}>
              {PRIORITY_TIER_DISPLAY[t].label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        label="Reason"
        required
        error={error ?? undefined}
        hint="Visible to government offices covering this problem — never to citizens."
      >
        <Textarea
          rows={3}
          value={reason}
          maxLength={PRIORITY_OVERRIDE_REASON_MAX}
          placeholder="e.g. School access road is required for emergency evacuation."
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Set priority
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
