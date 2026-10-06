import { Building2, MapPin } from 'lucide-react';
import type { OrganizationWorkspace, WorkspaceOrganizationType } from '@samadhaan/shared';
import { VerificationBadge } from '@/components/profile/verification-badge';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { MEMBERSHIP_ROLE_LABEL, formatLocation } from '@/lib/profile-display';
import { ORGANIZATION_TYPE_LABEL } from '@/lib/workspace';

/**
 * The organisation whose workspace this is, on every workspace page.
 *
 * Whose name you are acting under is the most important context in a shared
 * workspace, so it is written out — name, type, verification and your own
 * role — not left to a logo in the corner. Verification and role are text
 * badges with icons, never colour alone.
 */
export function WorkspaceHeader({ workspace }: { workspace: OrganizationWorkspace }) {
  const { organization, membership } = workspace;
  const location = formatLocation(organization.location);

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
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 type-caption text-ink-subtle">
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3.5" aria-hidden="true" />
              {ORGANIZATION_TYPE_LABEL[organization.type as WorkspaceOrganizationType]}
            </span>
            {location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden="true" />
                {location}
              </span>
            )}
          </p>
        </div>
        {/* Own row on a phone, so the name is not squeezed. */}
        <div className="flex w-full flex-wrap items-center gap-2 pl-[3.25rem] sm:w-auto sm:pl-0">
          <VerificationBadge status={organization.verificationStatus} size="sm" />
          <Badge tone="neutral" size="sm">
            <span className="sr-only">Your role: </span>
            {MEMBERSHIP_ROLE_LABEL[membership.membershipRole]}
          </Badge>
        </div>
      </div>
    </div>
  );
}
