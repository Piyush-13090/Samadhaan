import { Gauge } from 'lucide-react';
import type { Metadata } from 'next';
import { WorkspacePlaceholder } from '@/components/layout/workspace-placeholder';
import { requireRole } from '@/lib/auth-server';

export const metadata: Metadata = { title: 'Command centre' };

export default async function GovernmentPage() {
  const user = await requireRole(['GOVERNMENT', 'ADMIN'], '/government');

  return (
    <WorkspacePlaceholder
      user={user}
      icon={Gauge}
      title="Command centre"
      description="Triage reported problems, allocate them to capable partners, and verify that they were actually fixed."
      upcoming={[
        {
          title: 'Triage queue',
          body: 'Problems ordered by predicted priority, with the reasons shown.',
        },
        {
          title: 'Allocation',
          body: 'Assign a problem to a verified organisation and open a resolution room.',
        },
        {
          title: 'Verification',
          body: 'Review completion evidence with AI-assisted checks before closing.',
        },
        {
          title: 'Analytics',
          body: 'Resolution rates by category, area and partner over time.',
        },
      ]}
    />
  );
}
