import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthenticatedUser } from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth-provider';
import * as authService from '@/services/auth.service';
import { routerMock } from '../../../vitest.setup';

vi.mock('@/services/auth.service');

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'citizen@samadhaan.dev',
  fullName: 'Priya Sharma',
  displayName: 'priya',
  avatarUrl: null,
  role: 'CITIZEN',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
  emailVerifiedAt: null,
};

/** Renders the auth state plus buttons that drive it. */
function Probe() {
  const { user, status, login, logout } = useAuth();

  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.email ?? 'none'}</span>
      <button onClick={() => void login('citizen@samadhaan.dev', 'DevPassword123!')}>
        Sign in
      </button>
      <button onClick={() => void logout()}>Sign out</button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.mocked(authService.refreshSession).mockRejectedValue(new Error('no session'));
  });

  it('starts unauthenticated when the server resolved no user', () => {
    render(
      <AuthProvider initialUser={null}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  // The server-resolved user is what prevents a signed-out flash on load.
  it('starts authenticated when the server resolved a user', () => {
    render(
      <AuthProvider initialUser={USER}>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('user')).toHaveTextContent('citizen@samadhaan.dev');
  });

  it('becomes authenticated after a successful sign-in', async () => {
    vi.mocked(authService.login).mockResolvedValue({ user: USER, expiresIn: 900 });

    render(
      <AuthProvider initialUser={null}>
        <Probe />
      </AuthProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });
    expect(screen.getByTestId('user')).toHaveTextContent('citizen@samadhaan.dev');
  });

  it('re-renders server components after sign-in so the shell updates', async () => {
    vi.mocked(authService.login).mockResolvedValue({ user: USER, expiresIn: 900 });

    render(
      <AuthProvider initialUser={null}>
        <Probe />
      </AuthProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalled());
  });

  it('clears the user and returns home on sign-out', async () => {
    vi.mocked(authService.logout).mockResolvedValue(undefined);

    render(
      <AuthProvider initialUser={USER}>
        <Probe />
      </AuthProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(routerMock.replace).toHaveBeenCalledWith('/');
  });

  // A failed sign-out must still clear local state, or the user is stranded in
  // a signed-in UI they cannot leave.
  it('signs out locally even when the request fails', async () => {
    vi.mocked(authService.logout).mockRejectedValue(new Error('network down'));

    render(
      <AuthProvider initialUser={USER}>
        <Probe />
      </AuthProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });
  });

  it('throws when used outside the provider, rather than failing silently', () => {
    // React logs the error boundary trace; silence it for this expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Probe />)).toThrow(/must be used within an <AuthProvider>/);

    spy.mockRestore();
  });
});
