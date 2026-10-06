import { Landmark } from 'lucide-react';
import type { GovernmentContext } from '@samadhaan/shared';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { MEMBERSHIP_ROLE_LABEL } from '@/lib/profile-display';
import { JurisdictionBadge, jurisdictionTypeLabel } from './jurisdiction-badge';

/** The office and its area, on every page of its portal. */
export function GovernmentHeader({ context }: { context: GovernmentContext }) {
  const { organization, membership } = context;
  const type = jurisdictionTypeLabel(organization.jurisdiction);

  return (
    <div className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <Avatar
          name={organization.name}
          src={organization.logoUrl ?? undefined}
          size="md"
          className="rounded-control"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate type-body font-semibold text-ink">{organization.name}</p>
          <p className="flex items-center gap-1 type-caption text-ink-subtle">
            <Landmark className="size-3.5" aria-hidden="true" />
            {type ?? 'Government office'}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 pl-[3.25rem] sm:w-auto sm:pl-0">
          <JurisdictionBadge jurisdiction={organization.jurisdiction} />
          <Badge tone="neutral" size="sm">
            <span className="sr-only">Your role: </span>
            {MEMBERSHIP_ROLE_LABEL[membership.membershipRole]}
          </Badge>
        </div>
      </div>
    </div>
  );
}
