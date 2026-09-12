import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ROLE_HOME_ROUTE,
  canRoleAccessPath,
  type AuthenticatedUser,
  type UserRole,
} from '@samadhaan/shared';
import { fetchCurrentUserOnServer } from '@/services/auth.service';

/**
 * Server-side session resolution — the authoritative check in the web app.
 *
 * Unlike `proxy.ts`, this actually calls the API, which verifies the token
 * signature and confirms the session row still exists. A forged or revoked
 * cookie fails here.
 *
 * Note that even this is not the last line of defence: the NestJS guards
 * re-check on every request, so a page that forgot to call `requireUser` still
 * cannot load another user's data.
 */

/** The signed-in user, or `null`. Never throws. */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();

  const header = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  return fetchCurrentUserOnServer(header);
}

/**
 * Requires a session, redirecting to sign-in otherwise.
 *
 * `redirect()` throws, so control never returns — which is what makes the
 * non-null return type honest and stops a page from accidentally rendering with
 * a null user.
 */
export async function requireUser(returnTo?: string): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();

  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login';
    redirect(target);
  }

  return user;
}

/**
 * Requires one of `roles`.
 *
 * A user with the wrong role is sent to their own home rather than shown a
 * 403 — being told an area exists that they cannot enter is both unhelpful and
 * a small disclosure about the platform's shape.
 */
export async function requireRole(
  roles: readonly UserRole[],
  returnTo?: string,
): Promise<AuthenticatedUser> {
  const user = await requireUser(returnTo);

  if (!roles.includes(user.role)) {
    redirect(ROLE_HOME_ROUTE[user.role]);
  }

  return user;
}

/** Whether a role may open a path. Mirrors the shared route map. */
export function roleCanAccess(role: UserRole, pathname: string): boolean {
  return canRoleAccessPath(role, pathname);
}
