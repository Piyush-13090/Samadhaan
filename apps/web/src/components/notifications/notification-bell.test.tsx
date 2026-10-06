import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { NotificationPage, NotificationView } from '@samadhaan/shared';
import { ToastProvider } from '@/components/ui/toast';
import { renderWithProviders, screen } from '@/test/render';
import { NotificationBell } from './notification-bell';
import { NotificationsProvider } from './notifications-provider';

const {
  fetchUnreadCount,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = vi.hoisted(() => ({
  fetchUnreadCount: vi.fn(),
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock('@/services/notifications.service', () => ({
  fetchUnreadCount,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification: vi.fn(),
}));

export function notification(
  overrides: Partial<NotificationView> = {},
): NotificationView {
  return {
    id: 'n1',
    type: 'AI_ANALYSIS_COMPLETED',
    title: 'AI analysis completed',
    message: 'Your report SAM-1023 has been analysed.',
    entityType: 'PROBLEM',
    href: '/problems/SAM-1023',
    problemPublicId: 'SAM-1023',
    isRead: false,
    readAt: null,
    createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    ...overrides,
  };
}

function page(items: NotificationView[], unreadCount: number): NotificationPage {
  return { items, nextCursor: null, unreadCount };
}

const render = (ui: ReactElement) =>
  renderWithProviders(
    <ToastProvider>
      <NotificationsProvider>{ui}</NotificationsProvider>
    </ToastProvider>,
  );

/** The desktop trigger. The phone link shares its name and is hidden by CSS. */
const trigger = () => screen.getByRole('button', { name: /^Notifications/ });

afterEach(() => vi.clearAllMocks());

describe('NotificationBell', () => {
  it('announces the unread count in its accessible name, not as a bare digit', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 5 });
    render(<NotificationBell />);

    await waitFor(() =>
      expect(trigger()).toHaveAccessibleName('Notifications, 5 unread'),
    );
    // The badge is visible but hidden from assistive technology.
    expect(screen.getAllByText('5')[0]!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('says none are unread, and shows no badge, at zero', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 0 });
    render(<NotificationBell />);

    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalled());
    expect(trigger()).toHaveAccessibleName('Notifications, none unread');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('caps a large count', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 240 });
    render(<NotificationBell />);

    await waitFor(() =>
      expect(trigger()).toHaveAccessibleName('Notifications, more than 99 unread'),
    );
    expect(screen.getAllByText('99+').length).toBeGreaterThan(0);
  });

  it('links straight to the activity center on a phone', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 2 });
    render(<NotificationBell />);

    const link = await screen.findByRole('link', { name: /^Notifications/ });
    expect(link).toHaveAttribute('href', '/notifications');
    expect(link.className).toContain('sm:hidden');
  });

  it('opens a popover with only the latest few', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 1 });
    fetchNotifications.mockResolvedValue(page([notification()], 1));
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(trigger());

    expect(await screen.findByText('AI analysis completed')).toBeInTheDocument();
    expect(fetchNotifications).toHaveBeenCalledWith({ limit: 5 });
    expect(screen.getByText(/2 minutes? ago/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all notifications' })).toHaveAttribute(
      'href',
      '/notifications',
    );
  });

  it('shows a loading state while the popover fetches', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 0 });
    fetchNotifications.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(trigger());
    expect(await screen.findByLabelText('Loading notifications')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('shows the empty state when there is nothing', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 0 });
    fetchNotifications.mockResolvedValue(page([], 0));
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(trigger());
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 0 });
    fetchNotifications
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(page([notification()], 1));
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('AI analysis completed')).toBeInTheDocument();
  });

  it('navigates to the notification’s destination and marks it read', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 1 });
    fetchNotifications.mockResolvedValue(page([notification()], 1));
    markNotificationRead.mockResolvedValue(notification({ isRead: true }));
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(trigger());
    const item = await screen.findByRole('link', { name: /AI analysis completed/ });
    expect(item).toHaveAttribute('href', '/problems/SAM-1023');

    await user.click(item);

    expect(markNotificationRead).toHaveBeenCalledWith('n1');
    await waitFor(() =>
      expect(trigger()).toHaveAccessibleName('Notifications, none unread'),
    );
  });

  it('marks all as read', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 2 });
    fetchNotifications.mockResolvedValue(
      page(
        [
          notification(),
          notification({ id: 'n2', title: 'New comment on your problem' }),
        ],
        2,
      ),
    );
    markAllNotificationsRead.mockResolvedValue({ updated: 2, unreadCount: 0 });
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(trigger());
    const list = await screen.findByRole('list', { name: 'Latest notifications' });
    expect(within(list).getAllByText(/^Unread:/)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(within(list).queryAllByText(/^Unread:/)).toHaveLength(0));
    expect(trigger()).toHaveAccessibleName('Notifications, none unread');
  });
});
