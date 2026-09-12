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

export function refreshSession(): Promise<AuthSessionResponse> {
  return api.post<AuthSessionResponse>('/auth/refresh');
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
