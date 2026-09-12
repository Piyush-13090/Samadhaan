import { Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AppConfig } from '../../config/app.config.js';

/** Cookie names. Prefixed so they cannot collide with anything else on the host. */
export const ACCESS_TOKEN_COOKIE = 'sam_access';
export const REFRESH_TOKEN_COOKIE = 'sam_refresh';

/**
 * Reads and writes the authentication cookies.
 *
 * Both are `httpOnly`, so JavaScript — including any script injected through an
 * XSS hole — cannot read them. This is the reason tokens are never returned in
 * a response body: putting them in `localStorage` would trade a cookie an
 * attacker cannot read for a string any injected script can exfiltrate.
 *
 * `sameSite: 'lax'` blocks cross-site POSTs from carrying the cookie, which is
 * the primary CSRF defence. It works because the browser reaches the API on its
 * own origin through the Next.js proxy, making these first-party cookies.
 *
 * The refresh cookie is additionally scoped to `/api/v1/auth`, so it is not
 * attached to ordinary API traffic — it is only sent where it is actually used.
 */
@Injectable()
export class AuthCookiesService {
  constructor(private readonly config: AppConfig) {}

  private baseOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      domain: this.config.cookieDomain,
      path: '/',
    };
  }

  setAccessToken(response: Response, token: string): void {
    response.cookie(ACCESS_TOKEN_COOKIE, token, {
      ...this.baseOptions(),
      maxAge: this.config.accessTokenTtlSeconds * 1000,
    });
  }

  setRefreshToken(response: Response, token: string): void {
    response.cookie(REFRESH_TOKEN_COOKIE, token, {
      ...this.baseOptions(),
      path: '/api/v1/auth',
      maxAge: this.config.refreshTokenTtlSeconds * 1000,
    });
  }

  /**
   * Clears both cookies.
   *
   * `clearCookie` only matches when path, domain and the security attributes
   * are identical to those used when setting — a mismatch silently leaves the
   * cookie in place, which would make logout appear to work while the session
   * cookie survives.
   */
  clear(response: Response): void {
    const base = this.baseOptions();
    response.clearCookie(ACCESS_TOKEN_COOKIE, base);
    response.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, path: '/api/v1/auth' });
  }

  readAccessToken(request: Request): string | undefined {
    return this.readCookie(request, ACCESS_TOKEN_COOKIE);
  }

  readRefreshToken(request: Request): string | undefined {
    return this.readCookie(request, REFRESH_TOKEN_COOKIE);
  }

  private readCookie(request: Request, name: string): string | undefined {
    const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[name];
  }
}
