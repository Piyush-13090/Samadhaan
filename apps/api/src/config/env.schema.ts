import { z } from 'zod';

/**
 * Single source of truth for every environment variable the API reads.
 * Validation runs once at bootstrap so a misconfigured deploy fails fast
 * and loudly instead of throwing at the first request.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().min(1).default('0.0.0.0'),

  /** Comma-separated list of browser origins allowed to call the API. */
  // Default matches WEB_PORT (3100), so the API accepts the dev frontend
  // even when CORS_ORIGINS is not set explicitly.
  CORS_ORIGINS: z.string().default('http://localhost:3100'),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_URL: z.string().url(),

  REDIS_URL: z.string().url(),

  AI_SERVICE_URL: z.string().url(),
  /** Timeout in ms for a single call from the API to the AI service. */
  AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /**
   * Shared secret sent as `x-internal-token` so the AI service can reject
   * traffic that did not come through the API boundary. Optional in
   * development; the AI service only enforces it when it has one configured.
   */
  AI_SERVICE_TOKEN: z.string().optional(),

  // --- Authentication -------------------------------------------------------
  /**
   * Signing key for access-token JWTs. Minimum 32 characters so a weak secret
   * cannot be set by accident — a guessable key defeats the whole scheme.
   * Generate with: openssl rand -base64 48
   */
  JWT_ACCESS_SECRET: z.string().min(32),
  /**
   * Access-token lifetime. Deliberately short: access tokens are stateless and
   * cannot be revoked, so the blast radius of a stolen one is bounded by this.
   */
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15m
  /** Refresh-token lifetime. Revocable at any time via the `sessions` table. */
  REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30), // 30d

  /**
   * Marks auth cookies `Secure`. Must be true in production; left configurable
   * so local HTTP development works without disabling the cookie entirely.
   */
  AUTH_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /**
   * Cookie domain. Unset in development so cookies stay host-only, which is
   * the safest default; set in production when the web app and API share a
   * registrable domain.
   */
  AUTH_COOKIE_DOMAIN: z.string().optional(),

  /** Failed login attempts allowed per email+IP within the window. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * Guards the development seed. `prisma/seed.ts` refuses to run unless this is
   * `true` AND `NODE_ENV` is not production — two independent conditions, so a
   * single misconfigured variable cannot create known-password accounts in a
   * live environment.
   */
  ALLOW_DEV_SEED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // --- Storage --------------------------------------------------------------
  /**
   * Which storage driver to use. Only `local` is implemented; an S3 driver
   * plugs into the same factory without touching problem logic.
   */
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  /** Directory the local driver writes to. Relative paths resolve from apps/api. */
  STORAGE_LOCAL_ROOT: z.string().default('.storage'),

  /**
   * Public base URL of the API, used to build media URLs. Distinct from
   * API_HOST/PORT, which describe the socket the process binds — behind a proxy
   * those are not the address a browser can reach.
   */
  PUBLIC_API_URL: z.string().url().default('http://localhost:3100'),

  // --- Uploads --------------------------------------------------------------
  /** Per-image byte cap. 8 MiB comfortably holds a modern phone photo. */
  UPLOAD_MAX_IMAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 1024 * 1024),
  /** Images allowed on one problem. */
  UPLOAD_MAX_IMAGES_PER_PROBLEM: z.coerce.number().int().positive().default(6),
  /**
   * How long an uploaded-but-unattached image stays claimable, in seconds.
   * Long enough to finish a report, short enough that abandoned uploads do not
   * accumulate indefinitely.
   */
  UPLOAD_PENDING_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
});

export type Env = z.infer<typeof envSchema>;

/**
 * `validate` hook for `ConfigModule`. Returns the parsed (and coerced) values,
 * so `ConfigService` serves numbers as numbers rather than strings.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
