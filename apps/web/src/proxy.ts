import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge routing for authentication.
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts`; the semantics are unchanged.
 *
 * **This is a UX optimisation, not a security control.** It runs on every
 * request including prefetches, so it only reads the presence of the session
 * cookie — it does not verify a signature or query the database. Its job is to
 * save a signed-out visitor a page render before the redirect.
 *
 * The real checks are elsewhere and are authoritative:
 *   - every protected page resolves the session server-side via `/auth/me`
 *   - the NestJS guards verify the token and the session row on every request
 *
 * A forged cookie gets past this file and is then rejected by both.
 */

const ACCESS_COOKIE = 'sam_access';
const REFRESH_COOKIE = 'sam_refresh';

/**
 * Route prefixes that require a session.
 *
 * Note `/organization` (singular) is the organisation *workspace* and is
 * protected; `/organizations/:slug` (plural) is a public civic profile and is
 * deliberately absent. The two are separate paths precisely so that
 * distinction is expressible — a single `/organization` tree would have made
 * the workspace and the public profile collide.
 */
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/nearby',
  '/my-problems',
  '/notifications',
  '/settings',
  '/profile',
  '/report',
  // The problem detail *page* lives in the authenticated shell, so the proxy
  // short-circuits a signed-out visit here rather than letting the layout do
  // it a render later. The API behind it is public — a civic report is a
  // public record — which is what a future shareable public view will use.
  '/problems',
  '/organization',
  '/government',
  '/admin',
];

/** Routes a signed-in user has no reason to see. */
const AUTH_ROUTES = ['/login', '/register'];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  // Presence only — never trusted as proof of identity. The refresh cookie
  // counts too: an expired access token is still a live session, and bouncing
  // the user to sign-in would be wrong.
  const hasSession =
    Boolean(request.cookies.get(ACCESS_COOKIE)) ||
    Boolean(request.cookies.get(REFRESH_COOKIE));

  if (!hasSession && matches(pathname, PROTECTED_PREFIXES)) {
    const url = new URL('/login', request.url);
    // Preserve the destination so sign-in can return the user to it.
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (hasSession && matches(pathname, AUTH_ROUTES)) {
    // Role-correct landing is decided by the page, which knows the real role;
    // this only keeps a signed-in user off the sign-in form.
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Skips API routes (the backend guards those), Next internals and static
   * files. `/api` in particular must not be rewritten here — it is proxied to
   * NestJS by `next.config.ts`.
   */
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)',
  ],
};
