import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@samadhaan/shared';
import { buildErrorResponse } from '../api-response.js';
import { getRequestId } from '../request-context.js';

/**
 * HTTP-level security for the API (Prompt 26).
 *
 * Security headers suit a JSON API: nothing may frame it, sniff it or run in
 * it. Routes that serve files set their own, stricter, Content-Type and CSP
 * after this runs (later `setHeader` calls win).
 */
export function securityHeaders(options: { production: boolean }) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // Problem photos are loaded by the web app on the same site.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
    // Authenticated JSON must not sit in shared caches. File routes override.
    res.setHeader('Cache-Control', 'no-store');
    if (options.production) {
      // Only over HTTPS deployments; a development HSTS pin on localhost
      // would break every other local site.
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const originOf = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/**
 * Cross-site request forgery defence, layered on `SameSite=Lax` cookies.
 *
 * SameSite stops cross-*site* requests carrying the cookie, but not requests
 * from a different origin on the same site (a sibling subdomain, another
 * localhost port). So every state-changing request from a browser must come
 * from an allowed origin:
 *
 *  - `Sec-Fetch-Site: cross-site` is refused outright;
 *  - an `Origin` header must be one of CORS_ORIGINS (`null` is refused);
 *  - without `Origin`, a `Referer` must be from an allowed origin.
 *
 * A request with neither header is not from a browser (browsers send `Origin`
 * on every POST/PUT/PATCH/DELETE), so server-to-server clients and tests keep
 * working; they hold no victim's cookies.
 */
export function csrfOriginCheck(allowedOrigins: string[]) {
  const allowed = new Set(
    allowedOrigins.map((o) => originOf(o)).filter((o): o is string => !!o),
  );
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!UNSAFE_METHODS.has(req.method)) return next();

    const fetchSite = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    let verdict: 'ok' | 'blocked' = 'ok';

    if (fetchSite === 'cross-site') verdict = 'blocked';
    else if (typeof origin === 'string') {
      const o = originOf(origin);
      if (!o || !allowed.has(o)) verdict = 'blocked';
    } else if (typeof referer === 'string') {
      const o = originOf(referer);
      if (!o || !allowed.has(o)) verdict = 'blocked';
    }

    if (verdict === 'ok') return next();
    res
      .status(403)
      .json(
        buildErrorResponse(
          ERROR_CODES.FORBIDDEN,
          'This request was blocked because it did not come from Samadhaan.',
          getRequestId(req),
        ),
      );
  };
}
