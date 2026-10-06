import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { NotificationPage, NotificationView } from '@samadhaan/shared';
import { ToastProvider } from '@/components/ui/toast';
import { renderWithProviders, screen } from '@/test/render';
import { NotificationCenter } from './notification-center';
import { NotificationItem } from './notification-item';
import { NotificationsProvider, UNREAD_POLL_INTERVAL_MS } from './notifications-provider';

const {
  fetchUnreadCount,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} = vi.hoisted(() => ({
  fetchUnreadCount: vi.fn(),
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  deleteNotification: vi.fn(),
}));

vi.mock('@/services/notifications.service', () => ({
  fetchUnreadCount,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
}));

function notification(overrides: Partial<NotificationView> = {}): NotificationView {
  return {
    id: 'n1',
    type: 'COMMENT_REPLIED',
    title: 'New reply to your comment',
    message: 'arjun replied to your comment on SAM-1023.',
    entityType: 'COMMENT',
    href: '/problems/SAM-1023#discussion',
    problemPublicId: 'SAM-1023',
    isRead: false,
    readAt: null,
    createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    ...overrides,
  };
}

const page = (
  items: NotificationView[],
  unreadCount: number,
  nextCursor: string | null = null,
): NotificationPage => ({ items, nextCursor, unreadCount });

const render = (ui: ReactElement) =>
  renderWithProviders(
    <ToastProvider>
      <NotificationsProvider>{ui}</NotificationsProvider>
    </ToastProvider>,
  );

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('NotificationCenter', () => {
  it('lists notifications with read and unread distinguished in text', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 1 });
    fetchNotifications.mockResolvedValue(
      page(
        [
          notification(),
          notification({
            id: 'n2',
            title: 'AI analysis completed',
            isRead: true,
            type: 'AI_ANALYSIS_COMPLETED',
          }),
        ],
        1,
      ),
    );
    render(<NotificationCenter />);

    const list = await screen.findByRole('list', { name: 'All notifications' });
    const [unread, read] = within(list).getAllByRole('link');
    expect(unread).toHaveAccessibleName(/^Unread: New reply to your comment/);
    expect(read).not.toHaveAccessibleName(/Unread/);
    expect(unread).toHaveAttribute('href', '/problems/SAM-1023#discussion');
  });

  it('shows a loading skeleton, then the list', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 0 });
    let release!: (value: NotificationPage) => void;
    fetchNotifications.mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<NotificationCenter />);

    expect(screen.getByLabelText('Loading notifications')).toBeInTheDocument();
    release(page([notification()], 1));
    expect(await screen.findByText('New reply to your comment')).toBeInTheDocument();
  });

  it('shows the error state and retries', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 0 });
    fetchNotifications
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(page([notification()], 1));
    const user = userEvent.setup();
    render(<NotificationCenter />);

    expect(await screen.findByText("Couldn't load notifications")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('New reply to your comment')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 0 });
    fetchNotifications.mockResolvedValue(page([], 0));
    render(<NotificationCenter />);

    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('switches to Unread and says so when there are none', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 0 });
    fetchNotifications
      .mockResolvedValueOnce(page([notification({ isRead: true })], 0))
      .mockResolvedValueOnce(page([], 0));
    const user = userEvent.setup();
    render(<NotificationCenter />);
    await screen.findByText('New reply to your comment');

    await user.click(screen.getByRole('tab', { name: /Unread/ }));

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(fetchNotifications).toHaveBeenLastCalledWith({ filter: 'unread' });
  });

  it('marks one read when it is opened', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 1 });
    fetchNotifications.mockResolvedValue(page([notification()], 1));
    markNotificationRead.mockResolvedValue(notification({ isRead: true }));
    const user = userEvent.setup();
    render(<NotificationCenter />);

    await user.click(
      await screen.findByRole('link', { name: /New reply to your comment/ }),
    );

    expect(markNotificationRead).toHaveBeenCalledWith('n1');
    expect(screen.getByRole('link', { name: /New reply/ })).not.toHaveAccessibleName(
      /Unread/,
    );
  });

  it('marks all read and announces it', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 2 });
    fetchNotifications.mockResolvedValue(
      page([notification(), notification({ id: 'n2' })], 2),
    );
    markAllNotificationsRead.mockResolvedValue({ updated: 2, unreadCount: 0 });
    const user = userEvent.setup();
    render(<NotificationCenter />);
    await screen.findAllByText('New reply to your comment');

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(screen.queryAllByText(/^Unread:/)).toHaveLength(0));
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 notifications marked as read.',
    );
  });

  it('dismisses a notification, restoring it if that fails', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 1 });
    fetchNotifications.mockResolvedValue(page([notification()], 1));
    deleteNotification.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<NotificationCenter />);

    const dismiss = await screen.findByRole('button', {
      name: 'Dismiss notification: New reply to your comment',
    });
    await user.click(dismiss);

    expect(
      await screen.findByText("Couldn't dismiss the notification"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /New reply to your comment/ }),
    ).toBeInTheDocument();

    deleteNotification.mockResolvedValueOnce({ unreadCount: 0 });
    await user.click(
      screen.getByRole('button', {
        name: 'Dismiss notification: New reply to your comment',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /New reply/ })).not.toBeInTheDocument(),
    );
  });

  it('pages with a button', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 0 });
    fetchNotifications
      .mockResolvedValueOnce(page([notification({ isRead: true })], 0, 'cursor-1'))
      .mockResolvedValueOnce(
        page([notification({ id: 'n2', title: 'Older notification', isRead: true })], 0),
      );
    const user = userEvent.setup();
    render(<NotificationCenter />);

    await user.click(await screen.findByRole('button', { name: 'Show more' }));

    expect(await screen.findByText('Older notification')).toBeInTheDocument();
    expect(fetchNotifications).toHaveBeenLastCalledWith({
      filter: 'all',
      cursor: 'cursor-1',
    });
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('renders message text as text, never markup', async () => {
    fetchUnreadCount.mockResolvedValue({ count: 0 });
    fetchNotifications.mockResolvedValue(
      page([notification({ message: '<img src=x onerror=alert(1)> commented.' })], 1),
    );
    render(<NotificationCenter />);

    expect(
      await screen.findByText('<img src=x onerror=alert(1)> commented.'),
    ).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('NotificationItem on a phone', () => {
  it('has a generous tap target and no fixed widths', () => {
    const { container } = renderWithProviders(
      <NotificationItem notification={notification()} onDelete={() => undefined} />,
    );

    expect(screen.getByRole('link').className).toContain('min-h-14');
    for (const element of container.querySelectorAll('*')) {
      const classes = element.getAttribute('class') ?? '';
      expect(classes).not.toMatch(/\bw-\[\d{3,}px\]/);
      expect(classes).not.toMatch(/\bmin-w-\[\d{3,}px\]/);
    }
  });
});

describe('NotificationsProvider', () => {
  it('polls while visible and refreshes when the tab regains focus', async () => {
    vi.useFakeTimers();
    fetchUnreadCount.mockResolvedValue({ count: 0 });
    renderWithProviders(
      <NotificationsProvider>
        <span />
      </NotificationsProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchUnreadCount).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNREAD_POLL_INTERVAL_MS);
    });
    expect(fetchUnreadCount).toHaveBeenCalledTimes(2);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchUnreadCount).toHaveBeenCalledTimes(3);
  });
});
