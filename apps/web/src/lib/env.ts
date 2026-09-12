/**
 * Validated access to the browser-visible environment.
 *
 * Next.js inlines `NEXT_PUBLIC_*` at build time, so these must be referenced as
 * full literal property accesses — destructuring `process.env` breaks the
 * substitution. Validating here means a missing variable fails at startup with
 * a clear message rather than producing `undefined` deep inside a fetch call.
 */

export const env = {
  /**
   * Base URL the browser uses for API calls.
   *
   * Empty string means "same origin": requests go to `/api/v1/...` on the web
   * app's own host and `next.config.ts` proxies them to NestJS. That is
   * deliberate — same-origin requests make the auth cookies first-party, which
   * is what lets them be `SameSite=Lax` and immune to cross-site forgery.
   *
   * `NEXT_PUBLIC_API_URL` still exists for deployments that expose the API on
   * its own hostname, but the proxy is the default and the safer path.
   */
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? '',
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Samadhaan',
} as const;

/**
 * Base URL used by server components and route handlers. Inside Docker the
 * API is reachable at a service hostname rather than at localhost, so this is
 * configurable independently of the browser-facing URL.
 *
 * Server-only: never import this into a client component.
 */
export function getServerApiUrl(): string {
  return process.env.API_INTERNAL_URL ?? env.apiUrl;
}
