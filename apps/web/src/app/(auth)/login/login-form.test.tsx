import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthenticatedUser } from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/components/auth/auth-provider';
import { ApiError } from '@/lib/api-error';
import * as authService from '@/services/auth.service';
import { routerMock } from '../../../../vitest.setup';
import { LoginForm } from './login-form';

vi.mock('@/services/auth.service');

function makeUser(role: AuthenticatedUser['role']): AuthenticatedUser {
  return {
    id: 'u1',
    email: `${role.toLowerCase()}@samadhaan.dev`,
    fullName: 'Test User',
    displayName: null,
    avatarUrl: null,
    role,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
    emailVerifiedAt: null,
  };
}

function renderForm() {
  return render(
    <AuthProvider initialUser={null}>
      <LoginForm />
    </AuthProvider>,
  );
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.mocked(authService.refreshSession).mockRejectedValue(new Error('no session'));
  });

  it('renders the sign-in form', () => {
    renderForm();

    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('disables submit until both fields are filled', async () => {
    renderForm();
    const submit = screen.getByRole('button', { name: 'Sign in' });

    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Email'), 'citizen@samadhaan.dev');
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Password'), 'DevPassword123!');
    expect(submit).toBeEnabled();
  });

  it('sends the credentials and routes to the role home', async () => {
    vi.mocked(authService.login).mockResolvedValue({
      user: makeUser('CITIZEN'),
      expiresIn: 900,
    });

    renderForm();

    await userEvent.type(screen.getByLabelText('Email'), 'citizen@samadhaan.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'DevPassword123!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(authService.login).toHaveBeenCalledWith({
        email: 'citizen@samadhaan.dev',
        password: 'DevPassword123!',
      });
    });
    expect(routerMock.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('routes a government user to their own workspace', async () => {
    vi.mocked(authService.login).mockResolvedValue({
      user: makeUser('GOVERNMENT'),
      expiresIn: 900,
    });

    renderForm();

    await userEvent.type(screen.getByLabelText('Email'), 'government@samadhaan.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'DevPassword123!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/government'));
  });

  it('shows the server error without revealing which field was wrong', async () => {
    vi.mocked(authService.login).mockRejectedValue(
      new ApiError({
        code: 'INVALID_CREDENTIALS',
        message: 'Incorrect email or password',
        status: 401,
      }),
    );

    renderForm();

    await userEvent.type(screen.getByLabelText('Email'), 'citizen@samadhaan.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Incorrect email or password')).toBeInTheDocument();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('offers a link to registration', () => {
    renderForm();

    expect(screen.getByRole('link', { name: /create account/i })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('lets the password be revealed', async () => {
    renderForm();

    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
  });
});
