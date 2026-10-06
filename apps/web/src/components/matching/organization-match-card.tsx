import { ArrowRight, Check, MapPin } from 'lucide-react';
import Link from 'next/link';
import type { ProblemOrganizationMatch } from '@samadhaan/shared';
import { VerificationBadge } from '@/components/profile/verification-badge';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import { describeReason } from '@/lib/matching';
import { ORGANIZATION_TYPE_LABEL } from '@/lib/workspace';
import { RelevanceIndicator } from './relevance-indicator';

/**
 * An organisation that may be able to help with a problem.
 *
 * Every line is evidence the matching engine recorded: the relevance score,
 * the declared areas of work that matched, and up to two reasons written from
 * the signals that fired. Nothing here says the organisation will act —
 * matching suggests, people decide.
 */
export function OrganizationMatchCard({
  match,
  className,
}: {
  match: ProblemOrganizationMatch;
  className?: string;
}) {
  const { organization } = match;
  const place = [organization.location.city, organization.location.state]
    .filter(Boolean)
    .join(', ');
  const reasons = match.reasons
    .filter((reason) => reason.code !== 'RELATED_ACTIVITY' || match.reasons.length < 3)
    .slice(0, 2);

  return (
    <Card as="article" className={className}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start gap-3">
          <Avatar
            name={organization.name}
            src={organization.logoUrl ?? undefined}
            size="md"
            className="rounded-control"
          />
          <div className="min-w-0 flex-1">
            <h3 className="truncate type-body-sm font-semibold text-ink">
              {organization.name}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 type-caption text-ink-subtle">
              <span>{ORGANIZATION_TYPE_LABEL[organization.type]}</span>
              {place && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" aria-hidden="true" />
                  {place}
                </span>
              )}
            </div>
          </div>
          <VerificationBadge status={organization.verificationStatus} size="sm" />
        </div>

        <RelevanceIndicator relevance={match.relevance} />

        {match.matchedExpertise.length > 0 && (
          <div>
            <p className="sr-only">Matching areas of work:</p>
            <ul className="flex flex-wrap gap-1.5">
              {match.matchedExpertise.slice(0, 3).map((entry) => (
                <li
                  key={`${entry.category}-${entry.subcategory ?? ''}`}
                  className="rounded-[6px] border border-border-subtle bg-subtle/60 px-2 py-0.5 type-caption text-ink-muted"
                >
                  {entry.subcategory ?? CATEGORY_DISPLAY[entry.category].label}
                </li>
              ))}
            </ul>
          </div>
        )}

        {reasons.length > 0 && (
          <ul className="space-y-1 type-caption text-ink-muted">
            {reasons.map((reason) => (
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

        <Link
          href={`/organizations/${organization.slug}`}
          className="inline-flex items-center gap-1 self-start type-body-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          View organisation
          <span className="sr-only">: {organization.name}</span>
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}
