import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema.js';

/**
 * Typed accessor over `ConfigService`. Modules inject this instead of reading
 * `process.env` directly, which keeps environment access in one place and
 * removes the `string | undefined` noise at every call site.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get port(): number {
    return this.get('API_PORT');
  }

  get host(): string {
    return this.get('API_HOST');
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.get('LOG_LEVEL');
  }

  /** Parsed CORS allow-list; empty entries are dropped. */
  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get databaseUrl(): string {
    return this.get('DATABASE_URL');
  }

  get redisUrl(): string {
    return this.get('REDIS_URL');
  }

  get aiServiceUrl(): string {
    return this.get('AI_SERVICE_URL').replace(/\/+$/, '');
  }

  get aiServiceTimeoutMs(): number {
    return this.get('AI_SERVICE_TIMEOUT_MS');
  }

  get aiServiceToken(): string | undefined {
    return this.get('AI_SERVICE_TOKEN');
  }

  // --- Authentication -------------------------------------------------------

  get jwtAccessSecret(): string {
    return this.get('JWT_ACCESS_SECRET');
  }

  get accessTokenTtlSeconds(): number {
    return this.get('JWT_ACCESS_TTL_SECONDS');
  }

  get refreshTokenTtlSeconds(): number {
    return this.get('REFRESH_TTL_SECONDS');
  }

  get cookieSecure(): boolean {
    return this.get('AUTH_COOKIE_SECURE');
  }

  get cookieDomain(): string | undefined {
    return this.get('AUTH_COOKIE_DOMAIN');
  }

  get authRateLimitMax(): number {
    return this.get('AUTH_RATE_LIMIT_MAX');
  }

  get authRateLimitWindowSeconds(): number {
    return this.get('AUTH_RATE_LIMIT_WINDOW_SECONDS');
  }

  get allowDevSeed(): boolean {
    return this.get('ALLOW_DEV_SEED');
  }

  // --- Storage and uploads --------------------------------------------------

  get storageProvider(): Env['STORAGE_PROVIDER'] {
    return this.get('STORAGE_PROVIDER');
  }

  get storageLocalRoot(): string {
    return this.get('STORAGE_LOCAL_ROOT');
  }

  /** Base URL a browser uses to reach the API; no trailing slash. */
  get publicApiUrl(): string {
    return this.get('PUBLIC_API_URL').replace(/\/+$/, '');
  }

  get maxImageBytes(): number {
    return this.get('UPLOAD_MAX_IMAGE_BYTES');
  }

  get maxImagesPerProblem(): number {
    return this.get('UPLOAD_MAX_IMAGES_PER_PROBLEM');
  }

  get pendingUploadTtlSeconds(): number {
    return this.get('UPLOAD_PENDING_TTL_SECONDS');
  }

  // --- Duplicate detection --------------------------------------------------

  /**
   * Every tunable of the duplicate detector, in one object.
   *
   * Returned as a single value rather than a dozen getters because the scoring
   * service takes the whole set: passing it explicitly is what makes scoring a
   * pure function of (signals, config) and therefore testable at any weighting,
   * including the learned weights that replace these later.
   */
  get geocoding(): GeocodingConfig {
    const key = this.get('GEOCODING_API_KEY');
    return {
      provider: this.get('GEOCODING_PROVIDER'),
      baseUrl: this.get('GEOCODING_BASE_URL').replace(/\/+$/, ''),
      apiKey: key && key.length > 0 ? key : null,
      userAgent: this.get('GEOCODING_USER_AGENT'),
      countryCodes: this.get('GEOCODING_COUNTRY_CODES')
        .split(',')
        .map((code) => code.trim().toLowerCase())
        .filter((code) => /^[a-z]{2}$/.test(code)),
      timeoutMs: this.get('GEOCODING_TIMEOUT_MS'),
    };
  }

  get matching(): MatchingConfig {
    return {
      enabled: this.get('MATCHING_ENABLED'),
      candidateLimit: this.get('MATCHING_CANDIDATE_LIMIT'),
      resultLimit: this.get('MATCHING_RESULT_LIMIT'),
      minScore: this.get('MATCHING_MIN_SCORE'),
      concurrency: this.get('MATCHING_CONCURRENCY'),
      // Never in tests: e2e suites create and delete fixtures, and a sweep
      // racing them would make results depend on timing.
      sweepOnStartup: this.get('MATCHING_SWEEP_ON_STARTUP') && this.nodeEnv !== 'test',
      sweepLimit: this.get('MATCHING_SWEEP_LIMIT'),
    };
  }

  get duplicateDetection(): DuplicateDetectionConfig {
    return {
      geoRadiusMeters: this.get('DUPLICATE_GEO_RADIUS_METERS'),
      maxDistanceMeters: this.get('DUPLICATE_MAX_DISTANCE_METERS'),
      geoGateFloor: this.get('DUPLICATE_GEO_GATE_FLOOR'),
      categoryGateFloor: this.get('DUPLICATE_CATEGORY_GATE_FLOOR'),
      candidateLimit: this.get('DUPLICATE_CANDIDATE_LIMIT'),
      resultLimit: this.get('DUPLICATE_RESULT_LIMIT'),
      minTextSimilarity: this.get('DUPLICATE_MIN_TEXT_SIMILARITY'),
      weights: {
        text: this.get('DUPLICATE_WEIGHT_TEXT'),
        image: this.get('DUPLICATE_WEIGHT_IMAGE'),
        geographic: this.get('DUPLICATE_WEIGHT_GEO'),
        category: this.get('DUPLICATE_WEIGHT_CATEGORY'),
        temporal: this.get('DUPLICATE_WEIGHT_TEMPORAL'),
      },
      highThreshold: this.get('DUPLICATE_HIGH_THRESHOLD'),
      possibleThreshold: this.get('DUPLICATE_POSSIBLE_THRESHOLD'),
      relatedThreshold: this.get('DUPLICATE_RELATED_THRESHOLD'),
      temporalHalfLifeDays: this.get('DUPLICATE_TEMPORAL_HALF_LIFE_DAYS'),
      temporalFloor: this.get('DUPLICATE_TEMPORAL_FLOOR'),
    };
  }
}

/** Weight given to each similarity signal before renormalisation. */
export interface DuplicateSignalWeights {
  text: number;
  image: number;
  geographic: number;
  category: number;
  temporal: number;
}

/**
 * Everything the duplicate detector is tuned by.
 *
 * Exported as a plain interface so the scoring service can be constructed with
 * an arbitrary configuration in tests — and so a future learned model can
 * supply its weights through the same door the heuristics use.
 */
export interface DuplicateDetectionConfig {
  geoRadiusMeters: number;
  maxDistanceMeters: number;
  geoGateFloor: number;
  categoryGateFloor: number;
  candidateLimit: number;
  resultLimit: number;
  minTextSimilarity: number;
  weights: DuplicateSignalWeights;
  highThreshold: number;
  possibleThreshold: number;
  relatedThreshold: number;
  temporalHalfLifeDays: number;
  temporalFloor: number;
}

export interface GeocodingConfig {
  provider: 'nominatim' | 'none';
  baseUrl: string;
  apiKey: string | null;
  userAgent: string;
  countryCodes: string[];
  timeoutMs: number;
}

export interface MatchingConfig {
  enabled: boolean;
  candidateLimit: number;
  resultLimit: number;
  minScore: number;
  concurrency: number;
  sweepOnStartup: boolean;
  sweepLimit: number;
}
