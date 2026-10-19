import type { AuthSessionResponse, AuthenticatedUser } from '@samadhaan/shared';
import { api } from '@/lib/api';
import { createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Auth calls, in one place.
 *
 * Every one goes through the shared `ApiClient`, which sends
 * `credentials: 'include'` — so the httpOnly cookies ride along and no token
 * ever passes through JavaScript. There is deliberately nothing here that
 * reads, writes or stores a token.
 */

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export function register(input: RegisterInput): Promise<AuthSessionResponse> {
  return api.post<AuthSessionResponse>('/auth/register', input);
}

export function login(input: LoginInput): Promise<AuthSessionResponse> {
  return api.post<AuthSessionResponse>('/auth/login', input);
}

export function logout(): Promise<void> {
  return api.post<void>('/auth/logout');
}

/** Web Locks name shared by every tab of this origin. */
export const REFRESH_LOCK = 'samadhaan:auth-refresh';
/** How long a tab waits for another tab's refresh before going ahead alone. */
const REFRESH_LOCK_WAIT_MS = 10_000;

let inFlight: Promise<AuthSessionResponse> | null = null;

/**
 * Rotates the refresh token, one request at a time per browser.
 *
 * The API treats two uses of one refresh token as replay and revokes every
 * session of the user, which is the right answer to a stolen token. But a
 * browser can produce that pattern on its own: React's development double
 * mount, or several tabs loading at once, each sending the same cookie. So:
 *
 * - within a tab, concurrent callers share one request;
 * - across tabs, a Web Lock serialises the requests. A tab that waited sends
 *   its request after the previous response set the new cookie, so it
 *   presents the current token and rotates normally.
 *
 * The server's replay detection is unchanged. Without Web Locks support, or
 * if the lock isn't granted in time, the request goes ahead unserialised,
 * which is the previous behaviour.
 */
export function refreshSession(): Promise<AuthSessionResponse> {
  inFlight ??= withRefreshLock(() =>
    api.post<AuthSessionResponse>('/auth/refresh'),
  ).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks?.request) return task();
  let started = false;
  try {
    return await locks.request(
      REFRESH_LOCK,
      { signal: AbortSignal.timeout(REFRESH_LOCK_WAIT_MS) },
      () => {
        started = true;
        return task();
      },
    );
  } catch (error) {
    // Only a lock that was never granted falls back. Once the request has
    // been sent it is never repeated: a retry could present a token the
    // server already rotated, which is exactly the replay pattern.
    if (!started) return task();
    throw error;
  }
}

export function fetchCurrentUser(): Promise<AuthenticatedUser> {
  return api.get<AuthenticatedUser>('/auth/me', { cache: 'no-store' });
}

export function updateProfile(
  input: Partial<Pick<AuthenticatedUser, 'fullName' | 'displayName' | 'avatarUrl'>>,
): Promise<AuthenticatedUser> {
  return api.patch<AuthenticatedUser>('/users/me', input);
}

/**
 * Resolves the signed-in user during server rendering.
 *
 * Server components have no browser cookie jar, so the incoming request's
 * cookies must be forwarded explicitly. Returns `null` when there is no valid
 * session — an unauthenticated visitor is an expected state, not an error.
 */
export async function fetchCurrentUserOnServer(
  cookieHeader: string,
): Promise<AuthenticatedUser | null> {
  if (!cookieHeader) return null;

  try {
    return await createServerApi().get<AuthenticatedUser>('/auth/me', {
      cache: 'no-store',
      headers: { cookie: cookieHeader },
    });
  } catch (error) {
    // 401 is the normal "not signed in" answer; anything else is still not a
    // reason to fail the page render, so the shell just shows a signed-out UI.
    if (error instanceof ApiError) return null;
    throw error;
  }
}
