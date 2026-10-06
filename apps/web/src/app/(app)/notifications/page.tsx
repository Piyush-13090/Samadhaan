import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { NotificationCenter } from '@/components/notifications/notification-center';

export const metadata: Metadata = { title: 'Notifications' };

/**
 * The activity center.
 *
 * Authentication is enforced by the `(app)` layout; the list itself is client
 * rendered because it pages, filters and marks items read in place, and the
 * shell's unread count must move with it.
 */
export default function NotificationsPage() {
  return (
    <PageContainer width="narrow">
      <PageHeading
        title="Notifications"
        description="Updates on your reports, your comments and the problems you follow."
      />

      <div className="mt-8">
        <NotificationCenter />
      </div>
    </PageContainer>
  );
}
