import { BadgeCheck, Building2, GraduationCap, Landmark, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import type { OrganizationKind, OrganizationSummary } from '@/types/domain';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

const KIND_META: Record<OrganizationKind, { label: string; icon: LucideIcon }> = {
  NGO: { label: 'NGO', icon: Users },
  UNIVERSITY: { label: 'University', icon: GraduationCap },
  INDUSTRY: { label: 'Industry', icon: Building2 },
  GOVERNMENT: { label: 'Government', icon: Landmark },
};

/**
 * An organisation that can take on problems.
 *
 * Leads with verification and resolved count because those are what a citizen
 * or an allocator actually weighs — focus areas answer "can they do this one",
 * the track record answers "will they".
 */
export function OrganizationCard({
  organization,
  className,
}: {
  organization: OrganizationSummary;
  className?: string;
}) {
  const meta = KIND_META[organization.kind];
  const Icon = meta.icon;

  return (
    <Card as="article" className={cn('p-4', className)}>
      <div className="flex items-start gap-3">
        <Avatar name={organization.name} src={organization.logoUrl} size="md" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate type-h4 text-ink">{organization.name}</h3>
            {organization.verified && (
              <span title="Verified organisation" className="shrink-0 text-primary">
                <BadgeCheck className="size-4" aria-hidden="true" />
                <span className="sr-only">Verified organisation</span>
              </span>
            )}
          </div>

          <p className="mt-0.5 inline-flex items-center gap-1.5 type-caption text-ink-muted">
            <Icon className="size-3.5" aria-hidden="true" />
            {meta.label}
            {organization.serviceArea && <span>· {organization.serviceArea}</span>}
          </p>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-1.5">
        {organization.focusAreas.map((area) => (
          <Badge key={area} tone="neutral" size="sm">
            {area}
          </Badge>
        ))}
      </div>

      <p className="mt-3.5 border-t border-border-subtle pt-3 type-caption text-ink-muted">
        <span className="tabular font-semibold text-ink">
          {formatNumber(organization.problemsResolved)}
        </span>{' '}
        problems resolved
      </p>
    </Card>
  );
}
