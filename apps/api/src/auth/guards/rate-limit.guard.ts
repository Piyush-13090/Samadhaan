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
 * **Fails open.** If Redis is unavailable the request proceeds. Rate limiting
 * is a mitigation, not an authorisation control — authentication still runs —
 * and taking sign-in down entirely because a cache is down would be the worse
 * outcome. The failure is logged.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

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

    try {
      const count = await this.redis.connection.incr(key);

      // Only the first hit sets the TTL, which is what makes the window fixed.
      if (count === 1) {
        await this.redis.connection.expire(key, windowSeconds);
      }

      const remaining = Math.max(0, max - count);
      const response = http.getResponse<Response>();
      response.setHeader('x-ratelimit-limit', max);
      response.setHeader('x-ratelimit-remaining', remaining);

      if (count > max) {
        const retryAfter = await this.redis.connection.ttl(key);
        response.setHeader('retry-after', Math.max(retryAfter, 1));

        throw new AppException(
          ERROR_CODES.RATE_LIMITED,
          'Too many attempts. Please wait a few minutes and try again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof AppException) throw error;

      this.logger.warn(
        `Rate limiting unavailable, allowing request: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return true;
    }
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
