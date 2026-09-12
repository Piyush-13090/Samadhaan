import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { WorkspacePlaceholder } from '@/components/layout/workspace-placeholder';
import { requireRole } from '@/lib/auth-server';

export const metadata: Metadata = { title: 'Admin' };

export default async function AdminPage() {
  const user = await requireRole(['ADMIN'], '/admin');

  return (
    <WorkspacePlaceholder
      user={user}
      icon={ShieldCheck}
      title="Platform administration"
      description="Manage accounts, verify organisations and keep the platform trustworthy."
      upcoming={[
        { title: 'Users', body: 'Search accounts, adjust roles and handle suspensions.' },
        {
          title: 'Organisations',
          body: 'Review verification evidence and approve partner accounts.',
        },
        { title: 'Moderation', body: 'Review reported content and moderation queues.' },
        {
          title: 'System',
          body: 'Service health, job queues and platform configuration.',
        },
      ]}
    />
  );
}
