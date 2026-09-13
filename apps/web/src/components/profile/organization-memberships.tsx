import { ArrowRight, BadgeCheck, Building2 } from 'lucide-react';
import Link from 'next/link';
import type { ProfileOrganizationMembership } from '@samadhaan/shared';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { MEMBERSHIP_ROLE_LABEL } from '@/lib/profile-display';

/** Organisations a user belongs to, linking to each public profile. */
export function OrganizationMemberships({
  memberships,
}: {
  memberships: ProfileOrganizationMembership[];
}) {
  return (
    <Card>
      <CardHeader
        title="Organisations"
        description="Bodies this account works with on Samadhaan."
      />

      <CardBody className={memberships.length === 0 ? 'p-0' : 'p-2'}>
        {memberships.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Building2}
            title="No organisations yet"
            description="NGOs, universities, industry partners and government offices are onboarded by Samadhaan."
          />
        ) : (
          <ul className="space-y-1">
            {memberships.map((membership) => (
              <li key={membership.organizationId}>
                <Link
                  href={`/organizations/${membership.slug}`}
                  className="group flex items-center gap-3 rounded-control px-2.5 py-2.5 transition-colors hover:bg-subtle"
                >
                  <Avatar
                    name={membership.name}
                    src={membership.logoUrl ?? undefined}
                    size="sm"
                  />

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate type-body-sm font-medium text-ink">
                        {membership.name}
                      </span>
                      {membership.verificationStatus === 'VERIFIED' && (
                        <span
                          title="Verified organisation"
                          className="shrink-0 text-primary"
                        >
                          <BadgeCheck className="size-3.5" aria-hidden="true" />
                          <span className="sr-only">Verified organisation</span>
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block type-caption text-ink-subtle">
                      {MEMBERSHIP_ROLE_LABEL[membership.membershipRole]}
                      {membership.joinedAt === null && ' · invitation pending'}
                    </span>
                  </span>

                  <Badge tone="neutral" size="sm">
                    {membership.type}
                  </Badge>

                  <ArrowRight
                    className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
