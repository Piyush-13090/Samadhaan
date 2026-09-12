import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { SystemHealthPanel } from '@/components/common/system-health-panel';
import { fetchSystemHealth } from '@/services/health.service';

export const metadata: Metadata = {
  title: 'System status',
};

// Health is live state — never prerender or cache this page.
export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const health = await fetchSystemHealth();

  return (
    <PageContainer>
      <PageHeading
        title="System status"
        description="Live health of the Samadhaan platform, reported by the API. Every value on this page comes from a real probe against a running service."
      />

      <div className="mt-10">
        <SystemHealthPanel result={health} />
      </div>
    </PageContainer>
  );
}
