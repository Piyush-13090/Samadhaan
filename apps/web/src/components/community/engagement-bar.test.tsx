import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProblemEngagement } from '@samadhaan/shared';
import { ApiError } from '@/lib/api-error';
import { ToastProvider } from '@/components/ui/toast';
import { renderWithProviders, screen } from '@/test/render';

/** Community actions report failures as toasts, so the provider the app supplies is needed. */
const render = (ui: React.ReactElement) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);
import { EngagementBar } from './engagement-bar';
import { EngagementProvider } from './engagement-context';

const { supportProblem, withdrawSupport, followProblem, unfollowProblem } = vi.hoisted(
  () => ({
    supportProblem: vi.fn(),
    withdrawSupport: vi.fn(),
    followProblem: vi.fn(),
    unfollowProblem: vi.fn(),
  }),
);

vi.mock('@/services/community.service', () => ({
  supportProblem,
  withdrawSupport,
  followProblem,
  unfollowProblem,
}));

function engagement(overrides: Partial<ProblemEngagement> = {}): ProblemEngagement {
  return {
    supportCount: 127,
    supportedByCurrentUser: false,
    followerCount: 23,
    followedByCurrentUser: false,
    commentCount: 12,
    acceptsEngagement: true,
    duplicateOfPublicId: null,
    ...overrides,
  };
}

function renderBar(initial = engagement()) {
  return render(
    <EngagementProvider publicId="SAM-1023" initial={initial}>
      <EngagementBar />
    </EngagementProvider>,
  );
}

/** Resolves when told to, so the in-flight state can be observed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.clearAllMocks());

describe('EngagementBar', () => {
  it('shows supporters, followers and comments from the server', () => {
    renderBar();

    const summary = screen.getByRole('list', { name: 'Community engagement' });
    expect(summary).toHaveTextContent('127 supporters');
    expect(summary).toHaveTextContent('23 following');
    expect(summary).toHaveTextContent('12 comments');
  });

  it('supports optimistically, then shows the server’s count', async () => {
    const pending = deferred<{ supportCount: number; supportedByCurrentUser: boolean }>();
    supportProblem.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: 'Support' }));

    // Immediately: the guess, and the button busy so a second tap cannot race.
    expect(screen.getByRole('list', { name: 'Community engagement' })).toHaveTextContent(
      '128 supporters',
    );
    // The design system's spinner announces "Loading" while the request runs.
    const busy = screen.getByRole('button', { name: /Supported/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    // The server knows better — someone else supported in the meantime.
    pending.resolve({ supportCount: 130, supportedByCurrentUser: true });

    await waitFor(() =>
      expect(
        screen.getByRole('list', { name: 'Community engagement' }),
      ).toHaveTextContent('130 supporters'),
    );
    expect(screen.getByRole('button', { name: 'Supported' })).toBeEnabled();
    expect(supportProblem).toHaveBeenCalledWith('SAM-1023');
    expect(screen.getByRole('status')).toHaveTextContent('You support this problem.');
  });

  it('withdraws support when tapped again', async () => {
    withdrawSupport.mockResolvedValue({
      supportCount: 127,
      supportedByCurrentUser: false,
    });
    const user = userEvent.setup();
    renderBar(engagement({ supportCount: 128, supportedByCurrentUser: true }));

    await user.click(screen.getByRole('button', { name: 'Supported' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Support' })).toBeEnabled(),
    );
    expect(withdrawSupport).toHaveBeenCalledWith('SAM-1023');
    expect(screen.getByRole('list', { name: 'Community engagement' })).toHaveTextContent(
      '127 supporters',
    );
  });

  it('rolls back and explains when the request fails', async () => {
    supportProblem.mockRejectedValue(
      new ApiError({
        code: 'INTERNAL_ERROR',
        message: 'Server unavailable',
        status: 503,
      }),
    );
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: 'Support' }));

    // Never left looking supported after a failure.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Support' })).toBeEnabled(),
    );
    expect(screen.getByRole('list', { name: 'Community engagement' })).toHaveTextContent(
      '127 supporters',
    );
    expect(await screen.findByText("Couldn't update your support")).toBeInTheDocument();
  });

  it('follows and unfollows, separately from support', async () => {
    followProblem.mockResolvedValue({ followerCount: 24, followedByCurrentUser: true });
    unfollowProblem.mockResolvedValue({
      followerCount: 23,
      followedByCurrentUser: false,
    });
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: 'Follow' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Following' })).toBeEnabled(),
    );
    expect(screen.getByRole('list', { name: 'Community engagement' })).toHaveTextContent(
      '24 following',
    );
    // Following is not supporting.
    expect(screen.getByRole('button', { name: 'Support' })).toBeInTheDocument();
    expect(supportProblem).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Following' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Follow' })).toBeEnabled(),
    );
    expect(unfollowProblem).toHaveBeenCalledWith('SAM-1023');
  });

  it('rolls back a failed follow', async () => {
    followProblem.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: 'Follow' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Follow' })).toBeEnabled(),
    );
    expect(screen.getByRole('list', { name: 'Community engagement' })).toHaveTextContent(
      '23 following',
    );
    expect(await screen.findByText("Couldn't update follow")).toBeInTheDocument();
  });

  it('is fully keyboard operable', async () => {
    supportProblem.mockResolvedValue({ supportCount: 128, supportedByCurrentUser: true });
    const user = userEvent.setup();
    renderBar();

    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Support' })).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(supportProblem).toHaveBeenCalledTimes(1));
  });

  it('points a duplicate at its canonical report instead of offering actions', () => {
    renderBar(engagement({ acceptsEngagement: false, duplicateOfPublicId: 'SAM-900' }));

    expect(screen.queryByRole('button', { name: 'Support' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SAM-900' })).toHaveAttribute(
      'href',
      '/problems/SAM-900',
    );
  });
});
