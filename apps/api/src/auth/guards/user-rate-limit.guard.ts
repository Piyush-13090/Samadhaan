import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ERROR_CODES } from '@samadhaan/shared';
import { AppException } from '../../common/app.exception.js';
import { RedisService } from '../../redis/redis.service.js';
import type { AuthenticatedRequest } from '../auth.types.js';

export const USER_RATE_LIMIT_KEY = 'samadhaan:userRateLimit';

export interface UserRateLimitOptions {
  /**
   * Bucket name shared by every route that should draw on the same allowance,
   * e.g. `comment:write`. Named rather than derived from the path, because the
   * path contains the problem id — and a spammer moving between problems must
   * still be drawing on one allowance.
   */
  bucket: string;
  /** Actions allowed per window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Shown to the user when the limit is hit. */
  message?: string;
}

/**
 * Per-user rate limiting for authenticated actions.
 *
 * The global `RateLimitGuard` runs *before* authentication — correctly, for
 * sign-in — so it can only key on IP. That is the wrong unit for user-generated
 * content: a campus or office NAT puts hundreds of legitimate commenters behind
 * one address, while one account on mobile data changes address constantly.
 *
 * Applied with `UseGuards` at the method, which Nest runs after the global
 * guards, so the verified principal is available. Same fixed-window mechanics
 * and the same fail-open stance as the global guard: this is abuse mitigation,
 * not authorisation, and a Redis outage must not stop civic discussion.
 */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(UserRateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<UserRateLimitOptions | undefined>(
      USER_RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request & AuthenticatedRequest>();

    // Only reachable on authenticated routes; an anonymous request was already
    // refused by the JWT guard. Nothing to key on means nothing to limit.
    const userId = request.user?.id;
    if (!userId) return true;

    const key = `ratelimit:user:${options.bucket}:${userId}`;

    try {
      const count = await this.redis.connection.incr(key);
      if (count === 1) await this.redis.connection.expire(key, options.windowSeconds);

      const response = http.getResponse<Response>();
      response.setHeader('x-ratelimit-limit', options.max);
      response.setHeader('x-ratelimit-remaining', Math.max(0, options.max - count));

      if (count > options.max) {
        const retryAfter = await this.redis.connection.ttl(key);
        response.setHeader('retry-after', Math.max(retryAfter, 1));

        throw new AppException(
          ERROR_CODES.RATE_LIMITED,
          options.message ?? 'You are doing that too often. Please wait a moment.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof AppException) throw error;

      this.logger.warn(
        `User rate limiting unavailable, allowing request: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return true;
    }
  }
}

/** Limits an authenticated action per user. See `UserRateLimitGuard`. */
export const UserRateLimit = (options: UserRateLimitOptions) =>
  applyDecorators(
    SetMetadata(USER_RATE_LIMIT_KEY, options),
    UseGuards(UserRateLimitGuard),
  );
