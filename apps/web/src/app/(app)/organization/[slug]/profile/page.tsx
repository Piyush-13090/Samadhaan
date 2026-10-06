import { ExternalLink, Globe, Mail, MapPin, Pencil, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { WorkspaceOrganizationType } from '@samadhaan/shared';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { ExpertiseList } from '@/components/profile/expertise-list';
import { VerificationBadge } from '@/components/profile/verification-badge';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { VERIFICATION_DISPLAY, formatLocation } from '@/lib/profile-display';
import { requestCookieHeader } from '@/lib/request-cookies';
import { ORGANIZATION_TYPE_LABEL, workspacePath } from '@/lib/workspace';
import { fetchWorkspaceOnServer } from '@/services/workspace.service';

export const metadata: Metadata = { title: 'Organisation profile' };

/**
 * The organisation's profile, as its members see it — including contact
 * details the public profile withholds until verification. Editing happens in
 * Settings, for owners and admins.
 */
export default async function WorkspaceProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await fetchWorkspaceOnServer(slug, await requestCookieHeader());
  if (result.kind !== 'ok') notFound();

  const { organization, permissions } = result.workspace;
  const location = formatLocation(organization.location);
  const verification = VERIFICATION_DISPLAY[organization.verificationStatus];

  return (
    <PageContainer>
      <PageHeading
        title="Organisation profile"
        description="How your organisation is presented on Samadhaan."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" trailingIcon={<ExternalLink />} asChild>
              <Link href={`/organizations/${organization.slug}`}>
                View public profile
              </Link>
            </Button>
            {permissions.canEditProfile && (
              <Button variant="primary" size="sm" leadingIcon={<Pencil />} asChild>
                <Link href={workspacePath(slug, 'settings')}>Edit in settings</Link>
              </Button>
            )}
          </div>
        }
      />

      <Card className="mt-6">
        <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Avatar
            name={organization.name}
            src={organization.logoUrl ?? undefined}
            size="xl"
            className="shrink-0 rounded-card"
          />
          <div className="min-w-0 flex-1">
            <h2 className="type-h2 text-ink">{organization.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <VerificationBadge status={organization.verificationStatus} />
              <span className="type-body-sm text-ink-muted">
                {ORGANIZATION_TYPE_LABEL[organization.type as WorkspaceOrganizationType]}
              </span>
            </div>
            {organization.description ? (
              <p className="mt-4 max-w-prose whitespace-pre-line type-body text-ink-muted">
                {organization.description}
              </p>
            ) : (
              <p className="mt-4 type-body-sm text-ink-subtle">No description yet.</p>
            )}
          </div>
        </CardBody>
      </Card>

      {organization.verificationStatus !== 'VERIFIED' && (
        <Alert
          className="mt-5"
          tone={organization.verificationStatus === 'PENDING' ? 'warning' : 'danger'}
          title={verification.label}
        >
          {organization.verificationStatus === 'PENDING'
            ? 'Samadhaan has not confirmed this organisation yet. Until it does, your contact details stay off the public profile.'
            : 'Contact details stay off the public profile while the organisation is not verified.'}{' '}
          Verification is carried out by Samadhaan and cannot be changed from the
          workspace.
        </Alert>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Contact and location" />
          <CardBody>
            <dl className="space-y-3 type-body-sm">
              <Detail icon={Globe} label="Website">
                {organization.websiteUrl ? (
                  <a
                    href={organization.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {new URL(organization.websiteUrl).hostname}
                  </a>
                ) : null}
              </Detail>
              <Detail icon={Mail} label="Email">
                {organization.email}
              </Detail>
              <Detail icon={Phone} label="Phone">
                {organization.phone}
              </Detail>
              <Detail icon={MapPin} label="Address">
                {[organization.address, location].filter(Boolean).join(', ') || null}
              </Detail>
            </dl>
            <p className="mt-4 type-caption text-ink-subtle">
              On Samadhaan since {formatDate(organization.createdAt)} ·{' '}
              {organization.memberCount}{' '}
              {organization.memberCount === 1 ? 'member' : 'members'}
            </p>
          </CardBody>
        </Card>

        <ExpertiseList expertise={organization.expertise} />
      </div>
    </PageContainer>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Globe;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
      <dt className="w-20 shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">
        {children ?? <span className="text-ink-subtle">Not set</span>}
      </dd>
    </div>
  );
}
