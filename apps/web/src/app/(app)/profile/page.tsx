import { Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { ActivitySummary } from '@/components/profile/activity-summary';
import { OrganizationMemberships } from '@/components/profile/organization-memberships';
import { ProfileHeader } from '@/components/profile/profile-header';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { fetchOwnProfileOnServer } from '@/services/profile.service';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = { title: 'Profile' };

/**
 * The signed-in user's profile.
 *
 * Everything shown is real: the profile comes from `/users/me` and the activity
 * counts from `/users/me/activity`, both computed from the database. Features
 * that do not exist yet render as honest empty states — a fabricated number
 * would be indistinguishable from a working feature and would quietly become a
 * lie to the user.
 */
export default function ProfilePage() {
  return (
    <PageContainer width="narrow">
      <PageHeading
        title="Profile"
        description="Your account and how you appear to others."
      />

      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileContent />
      </Suspense>
    </PageContainer>
  );
}

async function ProfileContent() {
  const cookieStore = await cookies();
  const header = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const data = await fetchOwnProfileOnServer(header);

  // The route group already requires a session; this covers the token expiring
  // between the layout's check and this fetch.
  if (!data) redirect('/login?next=%2Fprofile&reason=expired');

  const { profile, activity } = data;

  return (
    <div className="mt-8 space-y-5">
      <ProfileHeader
        profile={profile}
        action={
          <Button variant="secondary" size="sm" leadingIcon={<Pencil />} asChild>
            <Link href="#edit-profile">Edit profile</Link>
          </Button>
        }
      />

      <section aria-labelledby="impact-heading">
        <h2 id="impact-heading" className="sr-only">
          Impact summary
        </h2>
        <ActivitySummary activity={activity} />
      </section>

      <OrganizationMemberships memberships={profile.organizations} />

      <div id="edit-profile" className="scroll-mt-20">
        <ProfileForm profile={profile} />
      </div>

      <Card>
        <CardHeader
          title="Activity"
          description="Problems you reported, supported and commented on."
        />
        <CardBody className="p-0">
          <EmptyState
            size="sm"
            title="Activity feed coming soon"
            description="Your reports and contributions will be listed here once problem reporting is live."
          />
        </CardBody>
      </Card>
    </div>
  );
}

/** Mirrors the finished layout, so nothing jumps when the data arrives. */
function ProfileSkeleton() {
  return (
    <div className="mt-8 space-y-5" aria-busy="true" aria-label="Loading profile">
      <div className="rounded-card border border-border bg-surface p-5">
        <div className="flex flex-col gap-5 sm:flex-row">
          <Skeleton className="size-16 shrink-0 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="mt-2 h-4 w-24" />
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-32" />
            </div>
            <SkeletonText lines={2} className="mt-4" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>

      <Skeleton className="h-40" />
      <Skeleton className="h-96" />
    </div>
  );
}
