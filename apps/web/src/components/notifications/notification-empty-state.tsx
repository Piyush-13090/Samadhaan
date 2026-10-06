import { Bell, CheckCheck } from 'lucide-react';
import { EmptyState } from '@/components/ui/states';

/** No notifications — or, on the Unread tab, none left to read. */
export function NotificationEmptyState({
  filter = 'all',
  size = 'md',
}: {
  filter?: 'all' | 'unread';
  size?: 'sm' | 'md';
}) {
  return filter === 'unread' ? (
    <EmptyState
      size={size}
      icon={CheckCheck}
      title="You're all caught up"
      description="No unread notifications."
    />
  ) : (
    <EmptyState
      size={size}
      icon={Bell}
      title="No notifications yet"
      description="When your reports are analysed, supported or discussed, or a problem you follow changes, you'll hear about it here."
    />
  );
}
