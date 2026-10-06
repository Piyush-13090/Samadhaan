import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GovernmentMap } from '@/components/government/government-map';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { parseView } from '@/lib/map/config';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchGovernmentContextOnServer } from '@/services/government.service';

export const metadata: Metadata = { title: 'Jurisdiction map' };

/** The civic map, limited by the API to this office's jurisdiction. */
export default async function GovernmentMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ at?: string }>;
}) {
  const { slug } = await params;
  const { at } = await searchParams;
  const context = await fetchGovernmentContextOnServer(slug, await requestCookieHeader());
  if (context.kind !== 'ok') notFound();

  return (
    <PageContainer width="wide">
      <PageHeading
        title="Jurisdiction map"
        description="Reports inside your area. Every problem on the map is also in the list beside it."
      />
      <div className="mt-6">
        <GovernmentMap
          slug={slug}
          initialView={at ? parseView(at) : null}
          bounds={context.data.organization.jurisdiction.bbox}
        />
      </div>
    </PageContainer>
  );
}
