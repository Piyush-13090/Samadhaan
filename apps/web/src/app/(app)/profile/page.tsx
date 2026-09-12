import { BadgeCheck, Clock } from 'lucide-react';
import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { requireUser } from '@/lib/auth-server';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '@/lib/role-display';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = { title: 'Profile' };

/**
 * The signed-in user's profile.
 *
 * Everything shown is real data from `/auth/me`. Impact and activity have no
 * data source yet, so they render honest empty states rather than invented
 * numbers — a fabricated "480 points" would be indistinguishable from a
 * working feature and would quietly become a lie to the user.
 */
export default async function ProfilePage() {
  const user = await requireUser('/profile');

  return (
    <PageContainer width="narrow">
      <PageHeading
        title="Profile"
        description="Your account and how you appear to others."
      />

      <div className="mt-8 space-y-5">
        <Card>
          <CardBody className="flex flex-wrap items-start gap-5">
            <Avatar name={user.fullName} src={user.avatarUrl ?? undefined} size="xl" />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="type-h3 text-ink">{user.fullName}</h2>
                {user.emailVerifiedAt && (
                  <span title="Email verified" className="text-primary">
                    <BadgeCheck className="size-4" aria-hidden="true" />
                    <span className="sr-only">Email verified</span>
                  </span>
                )}
              </div>

              <p className="mt-0.5 type-body-sm text-ink-muted">{user.email}</p>

              {user.displayName && (
                <p className="mt-0.5 font-mono type-caption text-ink-subtle">
                  @{user.displayName}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="primary">{ROLE_LABEL[user.role]}</Badge>
                {user.status !== 'ACTIVE' && (
                  <Badge tone="warning">
                    {user.status === 'PENDING_VERIFICATION'
                      ? 'Pending verification'
                      : 'Suspended'}
                  </Badge>
                )}
              </div>

              <p className="mt-3 type-body-sm text-ink-muted">
                {ROLE_DESCRIPTION[user.role]}
              </p>

              <p className="mt-3 inline-flex items-center gap-1.5 type-caption text-ink-subtle">
                <Clock className="size-3.5" aria-hidden="true" />
                Member since {formatDate(user.createdAt)}
              </p>
            </div>
          </CardBody>
        </Card>

        <ProfileForm user={user} />

        <Card>
          <CardHeader
            title="Impact"
            description="Points earned when problems you contributed to are resolved."
          />
          <CardBody className="p-0">
            <EmptyState
              size="sm"
              title="No impact yet"
              description="Impact points are awarded once problem reporting and resolution are live."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Activity"
            description="Problems you reported, supported and commented on."
          />
          <CardBody className="p-0">
            <EmptyState
              size="sm"
              title="No activity yet"
              description="Your reports and contributions will appear here."
            />
          </CardBody>
        </Card>
      </div>
    </PageContainer>
  );
}
