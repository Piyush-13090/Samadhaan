import { Building2 } from 'lucide-react';
import type { Metadata } from 'next';
import { WorkspacePlaceholder } from '@/components/layout/workspace-placeholder';
import { requireRole } from '@/lib/auth-server';

export const metadata: Metadata = { title: 'Organisation' };

/** NGO, university and industry partners share this workspace. */
export default async function OrganizationPage() {
  const user = await requireRole(
    ['NGO', 'UNIVERSITY', 'INDUSTRY', 'ADMIN'],
    '/organization',
  );

  return (
    <WorkspacePlaceholder
      user={user}
      icon={Building2}
      title="Organisation workspace"
      description="Find problems that match what your organisation does, take them on, and report progress."
      upcoming={[
        {
          title: 'Opportunities',
          body: 'Problems matched to your capabilities and service area, ranked by fit.',
        },
        {
          title: 'Projects',
          body: 'Problems you have taken on, with milestones and progress updates.',
        },
        {
          title: 'Resolution rooms',
          body: 'Shared workspaces with government and other partners on a problem.',
        },
        {
          title: 'Impact reporting',
          body: 'Completion evidence, verification status and resolved totals.',
        },
      ]}
    />
  );
}
