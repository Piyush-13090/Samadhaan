import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { MapExplorer } from '@/components/map/map-explorer';
import { parseView } from '@/lib/map/config';
import { requireUser } from '@/lib/auth-server';
import { fetchOwnProfileOnServer } from '@/services/profile.service';

export const metadata: Metadata = { title: 'Map' };

/**
 * The civic map — where problems are, how severe, and what kind.
 *
 * The profile city is read here only as a starting view for the map. It is
 * the viewer's own coarse locality, it never leaves their browser session, and
 * it is never shown to anyone else.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ at?: string | string[] }>;
}) {
  await requireUser();

  // `?at=lat,lng,zoom` — e.g. "see problems nearby" from a problem page.
  // Validated by the same parser as the configured default; anything malformed
  // is ignored rather than trusted.
  const { at } = await searchParams;
  const initialView = typeof at === 'string' && at.length > 0 ? parseView(at) : null;

  const cookieStore = await cookies();
  const header = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const profile = await fetchOwnProfileOnServer(header);

  return (
    <PageContainer width="wide">
      <PageHeading
        title="Civic map"
        description="See where problems are reported, how severe they are, and what kind — then open any one for the details."
      />

      <div className="mt-6">
        <MapExplorer
          profileCity={profile?.profile.location.city ?? null}
          initialView={initialView}
        />
      </div>
    </PageContainer>
  );
}
