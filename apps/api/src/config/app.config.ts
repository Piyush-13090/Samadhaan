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
}
