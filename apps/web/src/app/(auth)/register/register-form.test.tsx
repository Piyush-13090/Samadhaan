import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthenticatedUser } from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/components/auth/auth-provider';
import { ApiError } from '@/lib/api-error';
import * as authService from '@/services/auth.service';
import { routerMock } from '../../../../vitest.setup';
import { RegisterForm } from './register-form';

vi.mock('@/services/auth.service');

const CITIZEN: AuthenticatedUser = {
  id: 'u1',
  email: 'new@example.com',
  fullName: 'New Citizen',
  displayName: null,
  avatarUrl: null,
  role: 'CITIZEN',
  status: 'PENDING_VERIFICATION',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
  emailVerifiedAt: null,
};

function renderForm() {
  return render(
    <AuthProvider initialUser={null}>
      <RegisterForm />
    </AuthProvider>,
  );
}

async function fillValidForm() {
  await userEvent.type(screen.getByLabelText('Full name'), 'New Citizen');
  await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'Monsoon-Drain-2026');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'Monsoon-Drain-2026');
}

describe('RegisterForm', () => {
  beforeEach(() => {
    vi.mocked(authService.refreshSession).mockRejectedValue(new Error('no session'));
  });

  it('renders the registration form', () => {
    renderForm();

    expect(
      screen.getByRole('heading', { name: /create your account/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  });

  // Users must know they cannot self-register as an organisation or government.
  it('states that this creates a citizen account', () => {
    renderForm();

    expect(screen.getByText(/citizen account/i)).toBeInTheDocument();
    expect(screen.getByText(/require verification/i)).toBeInTheDocument();
  });

  it('has no role selector at all', () => {
    renderForm();

    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('keeps submit disabled until every field is valid', async () => {
    renderForm();
    const submit = screen.getByRole('button', { name: 'Create account' });

    expect(submit).toBeDisabled();
    await fillValidForm();
    expect(submit).toBeEnabled();
  });

  it('blocks submission when the passwords differ', async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText('Full name'), 'New Citizen');
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Monsoon-Drain-2026');
    await userEvent.type(
      screen.getByLabelText('Confirm password'),
      'Different-Pass-2026',
    );

    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  it('blocks submission on a weak password', async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText('Full name'), 'New Citizen');
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'short');

    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  it('shows the password requirements as they are met', async () => {
    renderForm();

    await userEvent.type(screen.getByLabelText('Password'), 'Monsoon-Drain-2026');

    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  it('registers and routes to the citizen home', async () => {
    vi.mocked(authService.register).mockResolvedValue({ user: CITIZEN, expiresIn: 900 });

    renderForm();
    await fillValidForm();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(authService.register).toHaveBeenCalledWith({
        fullName: 'New Citizen',
        email: 'new@example.com',
        password: 'Monsoon-Drain-2026',
      });
    });
    expect(routerMock.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('maps a field-scoped server error onto its input', async () => {
    vi.mocked(authService.register).mockRejectedValue(
      new ApiError({
        code: 'CONFLICT',
        message: 'An account with this email already exists',
        status: 409,
        details: [{ field: 'email', message: 'This email is already registered' }],
      }),
    );

    renderForm();
    await fillValidForm();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('This email is already registered'),
    ).toBeInTheDocument();
  });
});
