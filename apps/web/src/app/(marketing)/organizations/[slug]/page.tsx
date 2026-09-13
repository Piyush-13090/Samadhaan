import { Building2, Globe, Mail, MapPin, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ExpertiseList } from '@/components/profile/expertise-list';
import { TeamList } from '@/components/profile/team-list';
import { VerificationBadge } from '@/components/profile/verification-badge';
import { PageContainer } from '@/components/layout/page-container';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { formatDate, formatNumber } from '@/lib/format';
import { formatLocation } from '@/lib/profile-display';
import { fetchOrganizationPage } from '@/services/profile.service';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Titles the tab with the organisation's real name where one exists. */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const cookieStore = await cookies();
  const header = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const data = await fetchOrganizationPage(slug, header);
  if (!data) return { title: 'Organisation not found' };

  return {
    title: data.organization.name,
    description: data.organization.description ?? undefined,
  };
}

/**
 * An organisation's public profile.
 *
 * Public by design — an organisation taking on civic work is a matter of public
 * record, and requiring a sign-in to look one up would defeat the point. The
 * API decides what a given viewer sees: contact details only for verified
 * organisations, and `viewerPermissions` only for members.
 */
export default async function OrganizationProfilePage({ params }: PageProps) {
  const { slug } = await params;

  return (
    <PageContainer>
      <Suspense fallback={<OrganizationSkeleton />}>
        <OrganizationContent slug={slug} />
      </Suspense>
    </PageContainer>
  );
}

async function OrganizationContent({ slug }: { slug: string }) {
  const cookieStore = await cookies();
  const header = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const data = await fetchOrganizationPage(slug, header);

  // Renders the app's 404 page rather than an empty shell.
  if (!data) notFound();

  const { organization, members, activity } = data;
  const location = formatLocation(organization.location);
  const canManage = organization.viewerPermissions?.canEdit === true;

  return (
    <>
      {/* --- Header ------------------------------------------------------- */}
      <Card>
        <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Avatar
            name={organization.name}
            src={organization.logoUrl ?? undefined}
            size="xl"
            className="shrink-0"
          />

          <div className="min-w-0 flex-1">
            <h1 className="type-h2 text-ink">{organization.name}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <VerificationBadge status={organization.verificationStatus} />
              <Badge tone="neutral" icon={<Building2 className="size-3" />}>
                {organization.type}
              </Badge>

              {location && (
                <span className="inline-flex items-center gap-1 type-caption text-ink-muted">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {location}
                </span>
              )}
            </div>

            {organization.description && (
              // Plain text node — organisation descriptions are user input and
              // must never be injected as markup.
              <p className="mt-4 max-w-prose type-body text-ink-muted whitespace-pre-line">
                {organization.description}
              </p>
            )}

            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 type-caption text-ink-muted">
              {organization.websiteUrl && (
                <div className="inline-flex items-center gap-1.5">
                  <dt className="sr-only">Website</dt>
                  <Globe className="size-3.5" aria-hidden="true" />
                  <dd>
                    <a
                      href={organization.websiteUrl}
                      target="_blank"
                      // noopener/noreferrer: the destination is user-supplied
                      // and must not get a handle on this window.
                      rel="noopener noreferrer nofollow"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {new URL(organization.websiteUrl).hostname}
                    </a>
                  </dd>
                </div>
              )}

              {organization.email && (
                <div className="inline-flex items-center gap-1.5">
                  <dt className="sr-only">Email</dt>
                  <Mail className="size-3.5" aria-hidden="true" />
                  <dd>{organization.email}</dd>
                </div>
              )}

              {organization.phone && (
                <div className="inline-flex items-center gap-1.5">
                  <dt className="sr-only">Phone</dt>
                  <Phone className="size-3.5" aria-hidden="true" />
                  <dd>{organization.phone}</dd>
                </div>
              )}

              <div>
                <dt className="sr-only">Joined</dt>
                <dd>On Samadhaan since {formatDate(organization.createdAt)}</dd>
              </div>
            </dl>
          </div>
        </CardBody>
      </Card>

      {organization.verificationStatus !== 'VERIFIED' && (
        <Alert
          tone={organization.verificationStatus === 'PENDING' ? 'warning' : 'danger'}
          title={
            organization.verificationStatus === 'PENDING'
              ? 'Awaiting verification'
              : 'Not currently verified'
          }
          className="mt-5"
        >
          Samadhaan has not confirmed this organisation. Contact details are withheld
          until it is verified.
        </Alert>
      )}

      {canManage && (
        <Alert tone="info" title="You manage this organisation" className="mt-5">
          Editing organisation details from this page arrives in a later release. The API
          already accepts the changes and enforces who may make them.
        </Alert>
      )}

      {/* --- Contribution summary ----------------------------------------- */}
      <section className="mt-5" aria-labelledby="contribution-heading">
        <h2 id="contribution-heading" className="sr-only">
          Civic contribution
        </h2>

        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Card as="li" className="p-4">
            <p className="type-caption text-ink-muted">Members</p>
            <p className="mt-1.5 tabular type-h2 text-ink">
              {formatNumber(organization.memberCount)}
            </p>
          </Card>

          <Card as="li" className="p-4">
            <p className="type-caption text-ink-muted">Areas of work</p>
            <p className="mt-1.5 tabular type-h2 text-ink">
              {formatNumber(organization.expertise.length)}
            </p>
          </Card>

          <Card as="li" className="p-4">
            <p className="type-caption text-ink-muted">Solutions suggested</p>
            <p className="mt-1.5 tabular type-h2 text-ink">
              {formatNumber(activity.suggestionsMade)}
            </p>
          </Card>

          <Card as="li" className="p-4">
            <p className="type-caption text-ink-muted">Problems resolved</p>
            {/* Null, not zero: allocation does not exist yet, so an
                organisation cannot yet be credited with resolving anything. */}
            <p className="mt-1.5 tabular type-h2 text-ink-subtle">
              {activity.problemsResolved === null
                ? '—'
                : formatNumber(activity.problemsResolved)}
            </p>
            {activity.problemsResolved === null && (
              <p className="mt-0.5 type-caption text-ink-subtle">Not yet available</p>
            )}
          </Card>
        </ul>
      </section>

      {/* --- Detail ------------------------------------------------------- */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <ExpertiseList expertise={organization.expertise} />
        <TeamList members={members} />
      </div>

      {organization.address && (
        <Card className="mt-5">
          <CardHeader title="Address" />
          <CardBody>
            <p className="type-body-sm text-ink-muted">{organization.address}</p>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function OrganizationSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading organisation">
      <div className="rounded-card border border-border bg-surface p-5">
        <div className="flex flex-col gap-5 sm:flex-row">
          <Skeleton className="size-16 shrink-0 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-7 w-64" />
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-6 w-20" />
            </div>
            <SkeletonText lines={2} className="mt-4" />
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
