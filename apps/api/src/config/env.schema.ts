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

  // --- Geocoding --------------------------------------------------------------
  /**
   * Which geocoder backs location search and reverse lookup. `none` turns both
   * off; the map and the report form still work with manual entry.
   *
   * The browser never calls the provider: requests go through the API, which
   * holds any key, caches results and rate-limits callers.
   */
  GEOCODING_PROVIDER: z.enum(['nominatim', 'none']).default('nominatim'),
  /** Nominatim-compatible base URL. Point at a self-hosted instance in production. */
  GEOCODING_BASE_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  /** Sent as a key/token where the provider needs one. Never sent to the browser. */
  GEOCODING_API_KEY: z.string().optional(),
  /**
   * Identifies this deployment to the provider. The public Nominatim service
   * requires a descriptive User-Agent with contact details.
   */
  GEOCODING_USER_AGENT: z.string().min(3).default('Samadhaan/0.1 (development)'),
  /** ISO 3166-1 alpha-2 codes, comma separated, that searches are limited to. */
  GEOCODING_COUNTRY_CODES: z.string().default('in'),
  GEOCODING_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

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

  // --- Organisation matching (Prompt 14) -----------------------------------
  // Retrieval and persistence limits. The scoring weights live in the AI
  // service (MATCHING_WEIGHT_*) beside the engine that applies them. See
  // docs/ML_ORGANIZATION_MATCHING.md.
  MATCHING_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Organisations retrieved by vector search, before detailed scoring. */
  MATCHING_CANDIDATE_LIMIT: z.coerce.number().int().min(5).max(200).default(40),
  /** Organisations kept per problem after ranking. */
  MATCHING_RESULT_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
  /** Below this relevance a match is not stored or shown. */
  MATCHING_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.35),
  /** Matching runs at once, per API process. */
  MATCHING_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  /**
   * On boot, embed organisations that have no embedding and re-match
   * problems with stale or missing matches — bounded per boot.
   */
  MATCHING_SWEEP_ON_STARTUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  MATCHING_SWEEP_LIMIT: z.coerce.number().int().min(0).max(5000).default(200),

  // --- AI Project Coordinator (Prompt 19) --------------------------------
  // See docs/AI_PROJECT_COORDINATOR.md. Health thresholds live here, not in
  // code, so they can be tuned without a deploy.
  COORDINATOR_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** How often the background check runs, in minutes. */
  COORDINATOR_SCHEDULE_MINUTES: z.coerce.number().int().min(15).max(1440).default(120),
  /** A project is not re-analysed in the background more often than this. */
  COORDINATOR_MIN_INTERVAL_HOURS: z.coerce.number().min(1).max(168).default(12),
  /** Projects analysed per background run. */
  COORDINATOR_BATCH_SIZE: z.coerce.number().int().min(0).max(200).default(10),
  /** After this long an insight is shown as possibly outdated. */
  COORDINATOR_INSIGHT_TTL_HOURS: z.coerce.number().min(1).max(168).default(24),
  /** Per project: a manual refresh is not accepted more often than this. */
  COORDINATOR_REFRESH_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(3600)
    .default(120),
  // Context sent to the model.
  COORDINATOR_MAX_MESSAGES: z.coerce.number().int().min(0).max(100).default(20),
  COORDINATOR_MAX_EVENTS: z.coerce.number().int().min(0).max(100).default(30),
  COORDINATOR_MAX_COMPLETED_TASKS: z.coerce.number().int().min(0).max(50).default(10),
  COORDINATOR_MAX_UPDATES: z.coerce.number().int().min(0).max(50).default(5),
  COORDINATOR_MAX_ANSWERED_QUESTIONS: z.coerce.number().int().min(0).max(50).default(10),
  // Health engine.
  /** Days without any project activity before it counts as inactive. */
  COORDINATOR_INACTIVITY_DAYS: z.coerce.number().int().min(1).max(60).default(4),
  /** Open work due within this many days is an approaching deadline. */
  COORDINATOR_DEADLINE_WINDOW_DAYS: z.coerce.number().int().min(1).max(30).default(3),
  /** This many overdue tasks (or more) puts a project AT_RISK. */
  COORDINATOR_AT_RISK_OVERDUE_TASKS: z.coerce.number().int().min(1).max(50).default(2),
  /** A BLOCKED task at one of these priorities makes the project BLOCKED. */
  COORDINATOR_BLOCKING_PRIORITIES: z
    .string()
    .default('HIGH,CRITICAL')
    .transform((value) =>
      value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  // Questions.
  COORDINATOR_MAX_OPEN_QUESTIONS: z.coerce.number().int().min(0).max(10).default(3),
  /** A question answered or dismissed is not asked again for this long. */
  COORDINATOR_QUESTION_COOLDOWN_DAYS: z.coerce.number().int().min(0).max(60).default(3),
  /** Unanswered questions expire after this long. */
  COORDINATOR_QUESTION_EXPIRY_DAYS: z.coerce.number().int().min(1).max(60).default(7),

  // --- Knowledge & RAG (Prompt 20) --------------------------------------
  // See docs/RAG_ARCHITECTURE.md. The hybrid weights are a documented
  // baseline, not a learned model.
  RAG_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Passages returned (and given to the model). */
  RAG_TOP_K: z.coerce.number().int().min(1).max(12).default(6),
  /** Candidates fetched by vector and keyword search before scoring. */
  RAG_CANDIDATES: z.coerce.number().int().min(5).max(200).default(40),
  /** Passages below this semantic similarity are dropped unless they contain half the query's terms. */
  RAG_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.25),
  /** If the best semantic similarity is below this, retrieval is "weak". */
  RAG_WEAK_SEMANTIC: z.coerce.number().min(0).max(1).default(0.35),
  /** Diversity re-ranking (MMR) over the top candidates. */
  RAG_RERANK_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  RAG_RERANK_TOP_K: z.coerce.number().int().min(2).max(50).default(15),
  RAG_WEIGHT_SEMANTIC: z.coerce.number().min(0).max(1).default(0.6),
  RAG_WEIGHT_KEYWORD: z.coerce.number().min(0).max(1).default(0.15),
  RAG_WEIGHT_SOURCE: z.coerce.number().min(0).max(1).default(0.1),
  RAG_WEIGHT_CONTEXT: z.coerce.number().min(0).max(1).default(0.1),
  RAG_WEIGHT_RECENCY: z.coerce.number().min(0).max(1).default(0.05),
  /** Characters of each passage sent to the model. */
  RAG_MAX_PASSAGE_CHARS: z.coerce.number().int().min(200).max(4000).default(1500),
  RAG_CHUNK_MAX_TOKENS: z.coerce.number().int().min(50).max(2000).default(350),
  RAG_CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).max(500).default(50),
  RAG_MAX_CHUNKS_PER_SOURCE: z.coerce.number().int().min(1).max(10000).default(2000),
  /** Query embeddings are cached (by model and text hash) this long. */
  RAG_QUERY_CACHE_SECONDS: z.coerce.number().int().min(0).max(604800).default(86400),
  /** Passages the AI Project Coordinator receives (0 disables). */
  RAG_COORDINATOR_TOP_K: z.coerce.number().int().min(0).max(10).default(3),
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
