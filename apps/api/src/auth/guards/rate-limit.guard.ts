import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { ERROR_CODES } from '@samadhaan/shared';
import { AppException } from '../../common/app.exception.js';
import { AppConfig } from '../../config/app.config.js';
import { RedisService } from '../../redis/redis.service.js';

export const RATE_LIMIT_KEY = 'samadhaan:rateLimit';

export interface RateLimitOptions {
  /** Requests allowed per window. Defaults to `AUTH_RATE_LIMIT_MAX`. */
  max?: number;
  /** Window length in seconds. Defaults to `AUTH_RATE_LIMIT_WINDOW_SECONDS`. */
  windowSeconds?: number;
  /**
   * Body field to include in the bucket key, e.g. `email`.
   *
   * Limiting by IP alone is too coarse — a shared connection or campus NAT
   * would lock out innocent users — and by email alone lets an attacker spread
   * a credential-stuffing run across many accounts. Combining them targets the
   * pattern that actually matters.
   */
  keyField?: string;
  /**
   * Requests allowed per window from one IP across *all* identities (Prompt
   * 26). Without it one address could try ten passwords against every email
   * in a list; with it, credential stuffing from one source is bounded too.
   */
  ipMax?: number;
}

/** Applies rate limiting to a route. See `RateLimitGuard` for semantics. */
export const RateLimit = (options: RateLimitOptions = {}) =>
  SetMetadata(RATE_LIMIT_KEY, options);

/**
 * Fixed-window rate limiting on Redis.
 *
 * A fixed window can allow up to 2× the limit across a boundary; a sliding
 * window avoids that at the cost of more state. For slowing credential stuffing
 * the difference does not matter, and this is two Redis commands.
 *
 * **Degrades, does not fail open** (Prompt 30). If Redis is unavailable the
 * limits are enforced per process from memory, so a Redis outage neither takes
 * sign-in down nor removes brute-force protection.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  /** In-process fallback windows, used only while Redis is unreachable. */
  private readonly local = new Map<string, { count: number; resetAt: number }>();
  private fallbackWarned = false;

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const max = options.max ?? this.config.authRateLimitMax;
    const windowSeconds = options.windowSeconds ?? this.config.authRateLimitWindowSeconds;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const key = this.buildKey(request, options.keyField);

    if (options.ipMax) {
      const ipKey = `ratelimit:${request.method}:${request.path}:${request.ip ?? 'unknown'}:*`;
      const ip = await this.hit(ipKey, windowSeconds);
      if (ip.count > options.ipMax) {
        http.getResponse<Response>().setHeader('retry-after', Math.max(ip.ttl, 1));
        this.logger.warn(
          `IP-wide rate limit reached on ${request.method} ${request.path}`,
        );
        throw new AppException(
          ERROR_CODES.RATE_LIMITED,
          'Too many attempts. Please wait a few minutes and try again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const { count, ttl } = await this.hit(key, windowSeconds);
    const response = http.getResponse<Response>();
    response.setHeader('x-ratelimit-limit', max);
    response.setHeader('x-ratelimit-remaining', Math.max(0, max - count));

    if (count > max) {
      response.setHeader('retry-after', Math.max(ttl, 1));
      throw new AppException(
        ERROR_CODES.RATE_LIMITED,
        'Too many attempts. Please wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Counts one hit in a fixed window and returns the count and seconds left.
   *
   * One atomic Redis round trip (Prompt 30): INCR and EXPIRE NX in a MULTI, so
   * a crash between them can no longer leave a counter that never expires.
   * When Redis is unavailable the window is kept in this process's memory
   * instead of failing open: sign-in stays up during a Redis outage, and
   * brute-force protection does too (per instance rather than global).
   */
  private async hit(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; ttl: number }> {
    try {
      const results = await this.redis.connection
        .multi()
        .incr(key)
        .expire(key, windowSeconds, 'NX')
        .ttl(key)
        .exec();
      if (!results || results.some(([error]) => error))
        throw new Error('rate limit MULTI failed');
      return { count: Number(results[0]?.[1]), ttl: Number(results[2]?.[1]) };
    } catch (error) {
      if (!this.fallbackWarned) {
        this.logger.warn(
          `Redis unavailable for rate limiting; using in-process limits: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        this.fallbackWarned = true;
      }
      return this.localHit(key, windowSeconds);
    }
  }

  private localHit(key: string, windowSeconds: number): { count: number; ttl: number } {
    const now = Date.now();
    if (this.local.size > 50_000) {
      for (const [k, v] of this.local) if (v.resetAt <= now) this.local.delete(k);
    }
    let entry = this.local.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.local.set(key, entry);
    }
    entry.count += 1;
    return { count: entry.count, ttl: Math.ceil((entry.resetAt - now) / 1000) };
  }

  /**
   * Builds the bucket key.
   *
   * The identifying field is hashed, never stored in plaintext: Redis keys turn
   * up in logs and `MONITOR` output, and a key literally containing every email
   * that attempted sign-in is an avoidable disclosure.
   */
  private buildKey(request: Request, keyField?: string): string {
    const route = `${request.method}:${request.path}`;
    const ip = request.ip ?? 'unknown';

    const body = request.body as Record<string, unknown> | undefined;
    const raw = keyField ? body?.[keyField] : undefined;
    const identity =
      typeof raw === 'string' && raw.length > 0
        ? createHash('sha256').update(raw.toLowerCase()).digest('hex').slice(0, 16)
        : 'anon';

    return `ratelimit:${route}:${ip}:${identity}`;
  }
}
