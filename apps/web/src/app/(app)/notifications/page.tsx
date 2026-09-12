import { Bell } from 'lucide-react';
import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { NotificationItem } from '@/components/common/notification-item';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { NOTIFICATIONS } from '@/data/activity';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return (
    <PageContainer width="narrow">
      <PageHeading title="Notifications" />

      <Card className="mt-8">
        <CardBody className="p-1.5">
          {NOTIFICATIONS.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="You're all caught up"
              description="New activity on problems you follow will appear here."
            />
          ) : (
            NOTIFICATIONS.map((notification) => (
              <NotificationItem key={notification.id} notification={notification} />
            ))
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
}
