import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Samadhaan keeps one `.env` at the repository root so the web app, the API
 * and the AI service cannot drift out of sync. Next.js only looks in its own
 * directory, so the root file is loaded here — before the config is evaluated,
 * which is early enough for `NEXT_PUBLIC_*` values to be inlined at build time.
 *
 * An `apps/web/.env` still wins, for local overrides: dotenv does not overwrite
 * variables that are already set.
 */
loadEnv({ path: '.env', quiet: true });
loadEnv({ path: '../../.env', quiet: true });

const API_ORIGIN = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const isProduction = process.env.NODE_ENV === 'production';

const originOf = (value: string | undefined): string | null => {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
};

/**
 * Content-Security-Policy (Prompt 26), built from what the app actually loads:
 * Next's inline bootstrap scripts (hence 'unsafe-inline'; 'unsafe-eval' only in
 * development for React refresh), the API (same origin through the rewrite, or
 * NEXT_PUBLIC_API_URL), the map style host and its blob workers, and https
 * images (organisation logos and avatars are external URLs). Frames are denied
 * outright. Tighten with nonces once inline scripts are removed.
 */
function contentSecurityPolicy(): string {
  const api = originOf(process.env.NEXT_PUBLIC_API_URL);
  const mapStyle = originOf(
    process.env.NEXT_PUBLIC_MAP_STYLE_URL ||
      'https://tiles.openfreemap.org/styles/liberty',
  );
  const connect = ["'self'", api, mapStyle, isProduction ? null : 'ws:'].filter(Boolean);
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https:${api && !api.startsWith('https:') ? ` ${api}` : ''}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Geolocation stays available to the app itself ("Near me").
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(self), payment=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProduction
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No framework fingerprint in responses (Prompt 26).
  poweredByHeader: false,

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },

  /**
   * Proxy API traffic through Next.js so the browser only ever talks to one
   * origin.
   *
   * This is what makes the authentication cookies first-party. Calling
   * `http://localhost:4000` directly from a page served on `:3100` is
   * cross-site, which would force `SameSite=None` — throwing away the browser's
   * built-in CSRF protection. Routed through here, the cookies are same-site
   * and `SameSite=Lax` does its job.
   *
   * Server components bypass this and call `API_INTERNAL_URL` directly, since
   * there is no browser and no cookie policy involved.
   */
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
  // The shared package ships TypeScript-compiled ESM; transpiling it here keeps
  // the workspace source as the single point of truth, with no build step
  // ordering requirement between the two packages.
  transpilePackages: ['@samadhaan/shared'],
  // Container builds (Prompt 30, infrastructure/docker/web.Dockerfile) set
  // NEXT_OUTPUT_STANDALONE=true: a self-contained server.js with only the
  // traced runtime files, traced from the monorepo root so the shared package
  // is included. Local `next dev` / `next start` are unaffected.
  ...(process.env.NEXT_OUTPUT_STANDALONE === 'true'
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
      }
    : {}),
  // Fail the build on a type error rather than shipping a broken page.
  // (Linting is a separate `npm run lint` step — Next 16 no longer runs it.)
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
