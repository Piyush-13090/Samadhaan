import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { NearbyProblems } from '@/components/discovery/nearby-problems';
import { requireUser } from '@/lib/auth-server';
import { fetchOwnProfileOnServer } from '@/services/profile.service';

export const metadata: Metadata = { title: 'Explore' };

/**
 * Problem discovery.
 *
 * The same backend query and the same component as the dashboard's nearby
 * section, with a larger page and the map always shown. Keeping one
 * implementation means the ranking a citizen sees on the home page is the
 * ranking they see here.
 *
 * Not a search page: full-text and semantic search are a later milestone. This
 * filters a feed; it does not query one.
 */
export default async function ExplorePage() {
  await requireUser();

  // The profile's city is the fallback origin when no device fix is granted.
  // `AuthenticatedUser` deliberately does not carry it — the session payload is
  // identity, not profile — so it is read here.
  const cookieStore = await cookies();
  const header = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const profile = await fetchOwnProfileOnServer(header);

  return (
    <PageContainer width="wide">
      <PageHeading
        title="Explore problems"
        description="Civic issues reported around you, ranked by distance, severity and how recent they are."
      />

      <NearbyProblems profileCity={profile?.profile.location.city ?? null} limit={24} className="mt-8" />
    </PageContainer>
  );
}
