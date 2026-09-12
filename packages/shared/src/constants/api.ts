/** Current API version segment. Every route is mounted under `/api/{version}`. */
export const API_VERSION = 'v1';

/** Global route prefix applied by the NestJS bootstrap. */
export const API_GLOBAL_PREFIX = 'api';

/** Header used to propagate a correlation id across web -> api -> ai. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Stable error codes. The web client switches on these rather than on
 * HTTP status codes or message strings.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** Credentials rejected. Deliberately identical for unknown email and wrong
      password, so the API cannot be used to enumerate registered addresses. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** The access token is missing, malformed or expired — the client should refresh. */
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  /** Authenticated, but the account is suspended or awaiting verification. */
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
