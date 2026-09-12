'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { homeRouteFor, useAuth } from '@/components/auth/auth-provider';
import { PasswordInput } from '@/components/auth/password-input';
import { PasswordStrength, evaluatePassword } from '@/components/auth/password-strength';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-error';

/**
 * Registration.
 *
 * Creates a citizen account — the only role a public form may produce. That is
 * enforced by the API (the DTO has no `role` field at all); saying so here is
 * about setting expectations, not about security.
 */
export function RegisterForm() {
  const { register, pending } = useAuth();
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touchedConfirm, setTouchedConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const context = useMemo(() => ({ email, fullName }), [email, fullName]);
  const strength = useMemo(
    () => evaluatePassword(password, context),
    [password, context],
  );

  const mismatch = touchedConfirm && confirm.length > 0 && confirm !== password;
  const canSubmit =
    fullName.trim().length >= 2 &&
    email.includes('@') &&
    strength.valid &&
    confirm === password;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    try {
      const user = await register({ fullName: fullName.trim(), email, password });
      router.replace(homeRouteFor(user));
    } catch (caught) {
      if (caught instanceof ApiError) {
        // Map field-scoped errors back onto their inputs; anything else becomes
        // a single banner.
        const mapped: Record<string, string> = {};
        for (const detail of caught.details ?? []) {
          if (detail.field) mapped[detail.field] = detail.message;
        }

        setFieldErrors(mapped);
        if (Object.keys(mapped).length === 0) setError(caught.message);
      } else {
        setError('Could not create your account. Please try again.');
      }
    }
  }

  return (
    <div>
      <h1 className="type-h1 text-ink">Create your account.</h1>
      <p className="mt-2 type-body text-ink-muted">
        Report problems in your area and follow them through to a fix.
      </p>

      {error && <Alert tone="danger" title={error} className="mt-6" />}

      <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
        <Field label="Full name" error={fieldErrors.fullName}>
          <Input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
            autoFocus
            required
            placeholder="Priya Sharma"
          />
        </Field>

        <Field label="Email" error={fieldErrors.email}>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </Field>

        <div>
          <Field label="Password" error={fieldErrors.password}>
            <PasswordInput
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          <PasswordStrength password={password} context={context} />
        </div>

        <Field
          label="Confirm password"
          error={mismatch ? 'Passwords do not match' : undefined}
        >
          <PasswordInput
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            onBlur={() => setTouchedConfirm(true)}
            autoComplete="new-password"
            required
          />
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={pending}
          disabled={!canSubmit}
          className="mt-2"
        >
          Create account
        </Button>
      </form>

      <p className="mt-5 type-caption text-ink-subtle">
        This creates a citizen account. NGOs, universities, industry partners and
        government offices are onboarded separately — their accounts require verification.
      </p>

      <p className="mt-6 type-body-sm text-ink-muted">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
