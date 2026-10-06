import {
  Copy,
  ExternalLink,
  Heart,
  MapPin,
  MessageSquare,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import type { GovernmentContext, GovernmentProblemDetail } from '@samadhaan/shared';
import { GovernmentAllocationPanel } from '@/components/allocation/government-allocation-panel';
import { ProblemOrganizationMatches } from '@/components/matching/problem-organization-matches';
import { AskKnowledge } from '@/components/knowledge/ask-knowledge';
import { ProblemLocationMap } from '@/components/map/problem-location-map';
import { CategoryBadge } from '@/components/problems/category-badge';
import { ProblemStatusBadge } from '@/components/problems/problem-status-badge';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CATEGORY_DISPLAY, SEVERITY_DISPLAY } from '@/lib/domain-display';
import {
  formatDateTime,
  formatDistance,
  formatNumber,
  formatRelativeTime,
} from '@/lib/format';
import { governmentPath, governmentProblemPath } from '@/lib/government';
import { AuditTimeline } from './audit-timeline';
import { InternalNotes } from './internal-notes';
import { ReviewActions } from './review-actions';

const percent = (value: number | null) =>
  value === null ? '—' : `${Math.round(value * 100)}%`;

/**
 * One problem, as a reviewing official needs it: the citizen's report, the AI
 * analysis with its provenance, duplicate signals, community evidence,
 * location and nearby reports, potentially relevant organisations — and the
 * review decision, internal notes and audit trail.
 *
 * Signals are presented as evidence, never as verdicts: a "possible duplicate"
 * is not a confirmed one, and support counts show interest, not validity.
 */
export function GovernmentProblemView({
  context,
  detail,
}: {
  context: GovernmentContext;
  detail: GovernmentProblemDetail;
}) {
  const slug = context.organization.slug;
  const { problem, analysis, duplicates, community, nearby } = detail;
  const place = [problem.location.address, problem.location.city]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={governmentPath(slug, 'problems')}
          className="type-caption font-medium text-primary underline-offset-2 hover:underline"
        >
          ← Review queue
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="font-mono type-body-sm text-ink-subtle">
            {problem.publicId}
          </span>
          <ProblemStatusBadge status={problem.status} />
          <SeverityBadge severity={problem.severity} />
          <Badge tone="neutral" size="sm">
            Urgency: {SEVERITY_DISPLAY[problem.urgency].label}
          </Badge>
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
          <span>Reported {formatDateTime(problem.createdAt)}</span>
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Citizen report" />
            <CardBody className="space-y-4">
              <p className="whitespace-pre-line type-body text-ink-muted">
                {problem.description}
              </p>
              {problem.images.length > 0 && (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {problem.images.map((image, index) => (
                    <li key={image.url}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- storage-served media */}
                      <img
                        src={image.url}
                        alt={`Photo ${index + 1} of the reported problem`}
                        className="aspect-square w-full rounded-control bg-subtle object-cover"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="AI problem intelligence"
              description="Produced by Samadhaan's analysis. A reviewer's decision is what counts."
              icon={<Sparkles className="size-4 text-ai" />}
            />
            <CardBody>
              {!analysis ? (
                <p className="type-body-sm text-ink-muted">
                  This report has not been analysed.
                </p>
              ) : analysis.status !== 'COMPLETED' ? (
                <p className="type-body-sm text-ink-muted">
                  Analysis {analysis.status === 'FAILED' ? 'failed' : 'is in progress'} (
                  {formatDateTime(analysis.analysedAt)}).
                </p>
              ) : (
                <div className="space-y-4">
                  <dl className="grid gap-x-6 gap-y-3 type-body-sm sm:grid-cols-2">
                    <Fact label="Category">
                      {analysis.category
                        ? CATEGORY_DISPLAY[analysis.category].label
                        : '—'}
                      {analysis.subcategory && ` → ${analysis.subcategory}`}
                    </Fact>
                    <Fact label="Severity">
                      {analysis.severity
                        ? SEVERITY_DISPLAY[analysis.severity].label
                        : '—'}
                      {analysis.severityScore !== null &&
                        ` · ${analysis.severityScore} / 10`}
                    </Fact>
                    <Fact label="Urgency">
                      {analysis.urgency ? SEVERITY_DISPLAY[analysis.urgency].label : '—'}
                    </Fact>
                    {/* Only when the model reported one — never invented. */}
                    {analysis.confidence !== null && (
                      <Fact label="AI confidence">{percent(analysis.confidence)}</Fact>
                    )}
                  </dl>
                  {analysis.summary && (
                    <div>
                      <p className="type-caption text-ink-muted">Summary</p>
                      <p className="mt-1 type-body-sm text-ink">{analysis.summary}</p>
                    </div>
                  )}
                  {analysis.observations.length > 0 && (
                    <div>
                      <p className="type-caption text-ink-muted">Evidence observed</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 type-body-sm text-ink">
                        {analysis.observations.map((observation) => (
                          <li key={observation}>{observation}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <dl className="grid gap-x-6 gap-y-2 border-t border-border-subtle pt-3 type-caption text-ink-muted sm:grid-cols-3">
                    <Fact label="Model">{analysis.modelName}</Fact>
                    <Fact label="Version">{analysis.modelVersion}</Fact>
                    <Fact label="Analysed">{formatDateTime(analysis.analysedAt)}</Fact>
                  </dl>
                  {analysis.textOnly && (
                    <p className="type-caption text-ink-subtle">
                      Analysed from the text only; no photo was used.
                    </p>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Duplicate intelligence"
              description="From duplicate detection. A possible duplicate is not a confirmed one."
              icon={<Copy className="size-4" />}
            />
            <CardBody className="space-y-3">
              {duplicates.confirmedOf && (
                <Alert tone="warning" title="Confirmed duplicate">
                  Confirmed as a duplicate of{' '}
                  <Link
                    className="font-medium text-primary underline-offset-2 hover:underline"
                    href={governmentProblemPath(slug, duplicates.confirmedOf.publicId)}
                  >
                    {duplicates.confirmedOf.publicId}
                  </Link>
                  .
                </Alert>
              )}
              {duplicates.possible.length === 0 && !duplicates.confirmedOf ? (
                <p className="type-body-sm text-ink-muted">
                  No possible duplicates detected.
                </p>
              ) : (
                <ul className="space-y-2">
                  {duplicates.possible.map((candidate) => (
                    <li
                      key={candidate.publicId}
                      className="rounded-control border border-border-subtle px-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            candidate.verdict === 'LIKELY_DUPLICATE'
                              ? 'warning'
                              : 'neutral'
                          }
                          size="sm"
                        >
                          {candidate.verdict === 'LIKELY_DUPLICATE'
                            ? 'Likely duplicate'
                            : 'Possible duplicate'}
                        </Badge>
                        <span className="font-mono type-caption text-ink-subtle">
                          {candidate.publicId}
                        </span>
                        <span className="ml-auto tabular type-body-sm font-semibold text-ink">
                          {percent(candidate.similarity)} similar
                        </span>
                      </div>
                      <p className="mt-1 type-body-sm text-ink">{candidate.title}</p>
                      <p className="mt-1 type-caption text-ink-muted">
                        Text {percent(candidate.signals.text)} · Location{' '}
                        {percent(candidate.signals.geographic)} · Category{' '}
                        {percent(candidate.signals.category)}
                        {candidate.distanceMeters !== null &&
                          ` · ${formatDistance(candidate.distanceMeters)} away`}
                      </p>
                      <Link
                        href={governmentProblemPath(slug, candidate.publicId)}
                        className="mt-1 inline-flex type-caption font-medium text-primary underline-offset-2 hover:underline"
                      >
                        View problem<span className="sr-only"> {candidate.publicId}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Community evidence"
              description="Interest from residents. Support shows concern, not proof that a report is valid."
              icon={<Users className="size-4" />}
            />
            <CardBody>
              <dl className="grid grid-cols-3 gap-3">
                <Metric icon={Heart} label="Supporters" value={community.supporters} />
                <Metric icon={Users} label="Following" value={community.followers} />
                <Metric
                  icon={MessageSquare}
                  label="Comments"
                  value={community.comments}
                />
              </dl>
              {community.lastCommentAt && (
                <p className="mt-3 type-caption text-ink-muted">
                  Last comment {formatRelativeTime(community.lastCommentAt)}.
                </p>
              )}
              <Button
                variant="link"
                size="sm"
                trailingIcon={<ExternalLink />}
                className="mt-2"
                asChild
              >
                <Link href={`/problems/${problem.publicId}`}>
                  Open the public page and discussion
                </Link>
              </Button>
            </CardBody>
          </Card>

          <GovernmentAllocationPanel
            slug={slug}
            publicId={problem.publicId}
            panel={detail.allocation}
          />

          {/* Before verification there is nothing to allocate, but the
              organisations matching suggests are still useful context. */}
          {detail.allocation.blockedReason === 'NOT_VERIFIED' &&
            detail.allocation.history.length === 0 && (
              <ProblemOrganizationMatches publicId={problem.publicId} />
            )}

          <AskKnowledge problemId={problem.publicId} />

          <Card>
            <CardHeader
              title="Activity"
              description="From the audit log, which cannot be edited."
            />
            <CardBody>
              {detail.audit.length === 0 ? (
                <p className="type-body-sm text-ink-muted">No review activity yet.</p>
              ) : (
                <AuditTimeline entries={detail.audit} showProblem={false} />
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-5">
          <ReviewActions
            slug={slug}
            publicId={problem.publicId}
            status={problem.status}
            allowed={detail.allowedTransitions}
          />

          <Card>
            <CardHeader title="Location" />
            <ProblemLocationMap
              problem={{ ...problem, voteCount: community.supporters }}
              mapHref={governmentPath(slug, 'map')}
            />
            <CardBody className="space-y-2">
              {problem.location.address && (
                <p className="type-body-sm text-ink">{problem.location.address}</p>
              )}
              <p className="type-caption text-ink-muted">
                {[
                  problem.location.city,
                  problem.location.state,
                  problem.location.postalCode,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </p>
              <p className="font-mono type-caption tabular text-ink-subtle">
                {problem.location.latitude.toFixed(5)},{' '}
                {problem.location.longitude.toFixed(5)}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Nearby"
              description={`Within ${formatDistance(nearby.radiusMeters)}, in your jurisdiction.`}
            />
            <CardBody className="space-y-3">
              <p className="type-body-sm text-ink">
                <span className="tabular font-semibold">{nearby.total}</span> other{' '}
                {nearby.total === 1 ? 'report' : 'reports'}, {nearby.sameCategory} in the
                same category.
              </p>
              {nearby.items.length > 0 && (
                <ul className="space-y-2">
                  {nearby.items.map((item) => (
                    <li key={item.publicId} className="type-caption">
                      <Link
                        href={governmentProblemPath(slug, item.publicId)}
                        className="font-medium text-ink hover:text-primary"
                      >
                        {item.title}
                      </Link>
                      <span className="block text-ink-subtle">
                        {item.publicId} · {SEVERITY_DISPLAY[item.severity].label} ·{' '}
                        {formatDistance(item.distanceMeters)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <InternalNotes
            slug={slug}
            publicId={problem.publicId}
            notes={detail.notes}
            canAdd={context.permissions.canAddNotes}
          />
        </aside>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="type-caption text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Heart;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-control border border-border-subtle px-3 py-2.5">
      <dt className="flex items-center gap-1 type-caption text-ink-muted">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1 tabular type-h4 text-ink">{formatNumber(value)}</dd>
    </div>
  );
}
