'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { canRoleAccessPath } from '@samadhaan/shared';
import { homeRouteFor, useAuth } from '@/components/auth/auth-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/auth/password-input';
import { ApiError } from '@/lib/api-error';

/**
 * Sign-in form.
 *
 * Validation is deliberately thin: the server decides, and the only useful
 * client-side check is that both fields are filled. Mirroring server rules here
 * would only tell an attacker what they are.
 */
export function LoginForm() {
  const { login, pending } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sessionExpired = searchParams.get('reason') === 'expired';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const user = await login(email, password);

      // Honour the page the user was heading to, but only if their role may
      // open it — otherwise an expired link would drop them somewhere they
      // cannot use, and the server would bounce them anyway.
      const next = searchParams.get('next');
      const destination =
        next && next.startsWith('/') && canRoleAccessPath(user.role, next)
          ? next
          : homeRouteFor(user);

      router.replace(destination);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not sign in. Please try again.',
      );
    }
  }

  return (
    <div>
      <h1 className="type-h1 text-ink">Welcome back.</h1>
      <p className="mt-2 type-body text-ink-muted">
        Sign in to report problems and follow their progress.
      </p>

      {sessionExpired && (
        <Alert tone="warning" title="Your session expired" className="mt-6">
          Please sign in again to continue.
        </Alert>
      )}

      {error && <Alert tone="danger" title={error} className="mt-6" />}

      <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            autoFocus
            required
            placeholder="you@example.com"
          />
        </Field>

        <Field label="Password">
          <PasswordInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={pending}
          disabled={!email || !password}
          className="mt-2"
        >
          Sign in
        </Button>
      </form>

      <p className="mt-6 type-body-sm text-ink-muted">
        Don&rsquo;t have an account?{' '}
        <Link
          href="/register"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create account
        </Link>
      </p>
    </div>
  );
}
