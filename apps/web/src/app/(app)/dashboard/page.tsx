import { Suspense } from 'react';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { CitizenDashboard } from '@/components/dashboard/citizen-dashboard';
import { PageContainer } from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { requireUser } from '@/lib/auth-server';
import { fetchCitizenDashboardOnServer } from '@/services/discovery.service';

export const metadata: Metadata = { title: 'Home' };

/**
 * Citizen home.
 *
 * Every figure is counted from the database — there are no fixtures left on
 * this page. The whole dashboard is one API call, so it paints in one go
 * rather than fanning out to a request per section on a phone connection.
 *
 * `Suspense` keeps the shell and greeting interactive while that call is in
 * flight, rather than blocking the route on it.
 */
export default async function DashboardPage() {
  // Establishes the session before anything renders; the inner fetch then
  // reuses the same cookies.
  await requireUser();

  return (
    <PageContainer width="wide">
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </PageContainer>
  );
}

async function DashboardContent() {
  const cookieStore = await cookies();
  const header = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const data = await fetchCitizenDashboardOnServer(header);

  return <CitizenDashboard data={data} />;
}

/** Mirrors the real layout, so the page does not jump as it fills in. */
function DashboardSkeleton() {
  return (
    <div className="space-y-10" aria-busy="true">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-80" />
        </div>
        <Skeleton className="h-11 w-44" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>

      <Skeleton className="h-64" />
      <Skeleton className="h-48" />
    </div>
  );
}
