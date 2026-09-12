import type { UserRole, UserStatus } from './roles.js';

/**
 * Authentication contracts shared by the API and the web app.
 *
 * `AuthenticatedUser` is the ONLY user shape that crosses the network. It is
 * defined here rather than derived from the Prisma model on purpose: deriving
 * it would mean every column added to `users` is exposed by default, and
 * `passwordHash` is one schema change away from leaking. This is an allow-list.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  /** ISO-8601. Rendered as "Member since". */
  createdAt: string;
  lastLoginAt: string | null;
  emailVerifiedAt: string | null;
}

/** Returned by register, login and refresh. */
export interface AuthSessionResponse {
  user: AuthenticatedUser;
  /**
   * Seconds until the access token expires. The client uses this to schedule a
   * refresh; the tokens themselves are in httpOnly cookies and are deliberately
   * never present in the response body, so JavaScript cannot read them.
   */
  expiresIn: number;
}

/** Minimum password length. Enforced on both sides; the API is authoritative. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Roles a visitor may self-assign at registration.
 *
 * Only `CITIZEN`. Organisation and government accounts are created through
 * verification and invitation flows in later milestones — letting a request
 * body choose its own role is textbook privilege escalation.
 */
export const PUBLIC_REGISTRATION_ROLES = [
  'CITIZEN',
] as const satisfies readonly UserRole[];

/**
 * Landing route for a role after sign-in.
 *
 * Shared so the API's redirect hints and the web app's routing cannot drift.
 */
export const ROLE_HOME_ROUTE: Record<UserRole, string> = {
  CITIZEN: '/dashboard',
  NGO: '/organization',
  UNIVERSITY: '/organization',
  INDUSTRY: '/organization',
  GOVERNMENT: '/government',
  ADMIN: '/admin',
};

/** Route prefixes each role is allowed to enter. */
export const ROLE_ALLOWED_PREFIXES: Record<UserRole, readonly string[]> = {
  CITIZEN: [
    '/dashboard',
    '/explore',
    '/nearby',
    '/my-problems',
    '/leaderboard',
    '/notifications',
    '/settings',
    '/profile',
    '/report',
  ],
  NGO: ['/organization', '/explore', '/notifications', '/settings', '/profile'],
  UNIVERSITY: ['/organization', '/explore', '/notifications', '/settings', '/profile'],
  INDUSTRY: ['/organization', '/explore', '/notifications', '/settings', '/profile'],
  GOVERNMENT: ['/government', '/explore', '/notifications', '/settings', '/profile'],
  ADMIN: [
    '/admin',
    '/government',
    '/organization',
    '/dashboard',
    '/explore',
    '/nearby',
    '/my-problems',
    '/leaderboard',
    '/notifications',
    '/settings',
    '/profile',
    '/report',
  ],
};

/** Whether `role` may open `pathname`. Used for UX routing only — the API decides. */
export function canRoleAccessPath(role: UserRole, pathname: string): boolean {
  return ROLE_ALLOWED_PREFIXES[role].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
