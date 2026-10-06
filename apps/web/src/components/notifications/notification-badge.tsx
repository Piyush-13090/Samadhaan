import { CountBadge } from '@/components/ui/badge';

/**
 * The unread count on the bell.
 *
 * Decorative to assistive technology: the bell's own accessible name already
 * says "Notifications, 5 unread", and announcing the number twice — once as a
 * bare "5" — would be noise.
 */
export function NotificationBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;

  return (
    <span aria-hidden="true" className={className}>
      <CountBadge count={count} />
    </span>
  );
}

/** "Notifications, 5 unread" — the bell's accessible name. */
export function bellLabel(count: number): string {
  if (count <= 0) return 'Notifications, none unread';
  if (count > 99) return 'Notifications, more than 99 unread';
  return `Notifications, ${count} unread`;
}
