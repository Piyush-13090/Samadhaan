import { Bell, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { WorkspaceOrganizationType } from '@samadhaan/shared';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { VerificationBadge } from '@/components/profile/verification-badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ExpertiseManager } from '@/components/workspace/expertise-manager';
import { OrganizationSettingsForm } from '@/components/workspace/organization-settings-form';
import { MEMBERSHIP_ROLE_LABEL } from '@/lib/profile-display';
import { requestCookieHeader } from '@/lib/request-cookies';
import { ORGANIZATION_TYPE_LABEL, workspacePath } from '@/lib/workspace';
import { fetchWorkspaceOnServer } from '@/services/workspace.service';

export const metadata: Metadata = { title: 'Organisation settings' };

/**
 * Organisation settings.
 *
 * Owners and admins edit information, contact details, location and areas of
 * expertise. Members see the same page read-only. What nobody can change here
 * — type, verification, roles — is listed as fixed, so its absence from the
 * form is not mistaken for an oversight.
 */
export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await fetchWorkspaceOnServer(slug, await requestCookieHeader());
  if (result.kind !== 'ok') notFound();

  const { workspace } = result;
  const { organization, permissions, membership } = workspace;

  return (
    <PageContainer>
      <PageHeading
        title="Settings"
        description={`Information, location and areas of expertise for ${organization.name}.`}
      />

      <div className="mt-6 space-y-5">
        {!permissions.canEditProfile && (
          <Alert tone="info" title="View only">
            You&rsquo;re a{' '}
            {MEMBERSHIP_ROLE_LABEL[membership.membershipRole].toLowerCase()} of this
            organisation. Only owners and admins can change its settings. The full profile
            is on the{' '}
            <Link
              href={workspacePath(slug, 'profile')}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              organisation page
            </Link>
            .
          </Alert>
        )}

        {permissions.canEditProfile && <OrganizationSettingsForm workspace={workspace} />}

        <ExpertiseManager
          organizationId={organization.id}
          expertise={organization.expertise}
          canManage={permissions.canManageExpertise}
        />

        <Card>
          <CardHeader
            title="Fixed by Samadhaan"
            description="These cannot be changed from the workspace."
            icon={<Lock className="size-4" />}
          />
          <CardBody>
            <dl className="grid gap-4 type-body-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-muted">Organisation type</dt>
                <dd className="mt-1 text-ink">
                  {
                    ORGANIZATION_TYPE_LABEL[
                      organization.type as WorkspaceOrganizationType
                    ]
                  }
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Verification</dt>
                <dd className="mt-1">
                  <VerificationBadge status={organization.verificationStatus} size="sm" />
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Public address</dt>
                <dd className="mt-1 break-all font-mono type-caption text-ink">
                  /organizations/{organization.slug}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Notifications"
            description="Notifications go to each member's own account."
            icon={<Bell className="size-4" />}
          />
          <CardBody>
            <p className="type-body-sm text-ink-muted">
              There are no organisation-wide notification preferences yet. Each member
              sees activity on the problems they support or follow in their own{' '}
              <Link
                href="/notifications"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                notifications
              </Link>
              .
            </p>
          </CardBody>
        </Card>
      </div>
    </PageContainer>
  );
}
