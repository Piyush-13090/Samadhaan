import type { UserRole, UserStatus } from '@samadhaan/shared';

/**
 * The authenticated principal attached to a request by `JwtAuthGuard`.
 *
 * Deliberately minimal — only what authorisation decisions need. Handlers that
 * want the full profile load it from the database; keeping the principal small
 * means the access token stays small and stale data cannot accumulate in it.
 */
export interface RequestUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  /** Session this request's access token was issued against. */
  sessionId: string;
}

/** Claims carried by an access-token JWT. */
export interface AccessTokenClaims {
  /** Subject — the user id. */
  sub: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  /** Session id, so a token can be traced back to the device that got it. */
  sid: string;
}

/** Express request once the guard has run. */
export interface AuthenticatedRequest {
  user?: RequestUser;
}
