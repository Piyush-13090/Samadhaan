import { config as loadEnv } from 'dotenv';
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

const nextConfig: NextConfig = {
  reactStrictMode: true,

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
  // Fail the build on a type error rather than shipping a broken page.
  // (Linting is a separate `npm run lint` step — Next 16 no longer runs it.)
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
