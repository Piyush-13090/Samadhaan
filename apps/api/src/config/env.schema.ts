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

  // --- Duplicate detection --------------------------------------------------
  // Every value here is a starting heuristic chosen by hand, not a learned
  // parameter. They live in configuration precisely because they are expected
  // to be tuned against real data — see docs/ML_DUPLICATE_DETECTION.md.

  /**
   * Radius, in metres, over which geographic similarity decays to zero.
   *
   * 750 m is a deliberate compromise: large enough that GPS drift and a
   * mis-dropped pin do not separate two reports of the same pothole, small
   * enough that two genuinely different potholes on the same arterial road do
   * not merge. Per-category radii are the obvious refinement — a blocked drain
   * is a point, an unlit street is a stretch.
   */
  DUPLICATE_GEO_RADIUS_METERS: z.coerce.number().positive().default(750),

  /**
   * Hard cut-off for candidate retrieval. A problem further than this is never
   * considered, whatever its text says. Two identically-worded potholes 500 km
   * apart are two potholes.
   */
  DUPLICATE_MAX_DISTANCE_METERS: z.coerce.number().positive().default(5000),

  /**
   * Geographic similarity at or above which distance stops suppressing a score.
   *
   * Geography can veto in a way word choice cannot: two reports describe the
   * same physical pothole only if they are in the same place. Below this value
   * the combined score is scaled down proportionally, so strong text similarity
   * cannot outvote a pair being demonstrably far apart. 0.25 corresponds to
   * roughly 1.4x the radius above.
   */
  DUPLICATE_GEO_GATE_FLOOR: z.coerce.number().min(0).max(1).default(0.25),

  /**
   * Category similarity at or above which category stops suppressing a score.
   *
   * The same necessity argument as the geographic gate, on the other axis: two
   * reports describe the same problem only if they are about the same kind of
   * thing. 0.4 clears every pairing in the affinity table (the loosest related
   * pair is 0.5) and suppresses only the "unrelated" floor of 0.1, which nearby
   * recent reports would otherwise ride over the related threshold.
   */
  DUPLICATE_CATEGORY_GATE_FLOOR: z.coerce.number().min(0).max(1).default(0.4),

  /** How many nearest neighbours the vector search returns before scoring. */
  DUPLICATE_CANDIDATE_LIMIT: z.coerce.number().int().positive().max(100).default(20),

  /** How many scored candidates are stored and shown. */
  DUPLICATE_RESULT_LIMIT: z.coerce.number().int().positive().max(20).default(5),

  /**
   * Minimum text cosine similarity for a candidate to be scored at all.
   *
   * Cheap pre-filter: below this the combined score cannot realistically clear
   * the related threshold, and scoring it costs a PostGIS distance computation
   * for nothing.
   */
  DUPLICATE_MIN_TEXT_SIMILARITY: z.coerce.number().min(0).max(1).default(0.35),

  // Signal weights. Renormalised over whatever signals are actually available,
  // so a missing image embedding redistributes its weight rather than scoring 0.
  DUPLICATE_WEIGHT_TEXT: z.coerce.number().min(0).default(0.35),
  DUPLICATE_WEIGHT_IMAGE: z.coerce.number().min(0).default(0.25),
  DUPLICATE_WEIGHT_GEO: z.coerce.number().min(0).default(0.25),
  DUPLICATE_WEIGHT_CATEGORY: z.coerce.number().min(0).default(0.1),
  DUPLICATE_WEIGHT_TEMPORAL: z.coerce.number().min(0).default(0.05),

  /**
   * Score at or above which a pair is called a likely duplicate.
   *
   * Never an automatic merge. This only decides the wording a citizen sees and
   * the `LIKELY_DUPLICATE` status on the stored row; confirmation stays human.
   */
  DUPLICATE_HIGH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  /** Score at or above which a pair is called a possible duplicate. */
  DUPLICATE_POSSIBLE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.65),
  /** Score below which a pair is not worth showing at all. */
  DUPLICATE_RELATED_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),

  /**
   * Half-life in days for the temporal signal.
   *
   * Supporting signal only, with a floor: a pothole unrepaired for two years is
   * still the same pothole when someone reports it again, so age must lower a
   * score without ever making an old problem unmatchable.
   */
  DUPLICATE_TEMPORAL_HALF_LIFE_DAYS: z.coerce.number().positive().default(120),
  /** Floor for the temporal signal, however old the candidate is. */
  DUPLICATE_TEMPORAL_FLOOR: z.coerce.number().min(0).max(1).default(0.35),
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
