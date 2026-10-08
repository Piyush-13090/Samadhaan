import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app.config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { RedisService } from '../redis/redis.service.js';

/**
 * Short-lived cache for analytics aggregates (Prompt 24).
 *
 * The key is a hash of everything that decides the answer: who may see it
 * (the scope kind and organisation or user), the jurisdiction predicate
 * itself, the endpoint, the resolved period (dates and time zone) and every
 * filter. Two offices, two jurisdictions or two time zones can never share an
 * entry. A Redis failure only means the query runs.
 */
@Injectable()
export class AnalyticsCacheService {
  private readonly logger = new Logger(AnalyticsCacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  static jurisdictionKey(condition: Prisma.Sql): string {
    return createHash('sha256')
      .update(condition.sql)
      .update(JSON.stringify(condition.values))
      .digest('hex')
      .slice(0, 16);
  }

  static key(parts: unknown[]): string {
    return `analytics:v1:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
  }

  async wrap<T>(
    parts: unknown[],
    compute: () => Promise<T>,
    seconds?: number,
  ): Promise<T> {
    const ttl = seconds ?? this.config.analytics.cacheSeconds;
    if (ttl <= 0) return compute();
    const key = AnalyticsCacheService.key(parts);
    const hit = await this.redis.connection.get(key).catch(() => null);
    if (hit) {
      try {
        return JSON.parse(hit) as T;
      } catch {
        // fall through and recompute
      }
    }
    const value = await compute();
    await this.redis.connection
      .set(key, JSON.stringify(value), 'EX', ttl)
      .catch((error: Error) =>
        this.logger.warn(`analytics cache write failed: ${error.message}`),
      );
    return value;
  }

  async get<T>(parts: unknown[]): Promise<T | null> {
    const hit = await this.redis.connection
      .get(AnalyticsCacheService.key(parts))
      .catch(() => null);
    if (!hit) return null;
    try {
      return JSON.parse(hit) as T;
    } catch {
      return null;
    }
  }

  async set(parts: unknown[], value: unknown, seconds: number): Promise<void> {
    await this.redis.connection
      .set(AnalyticsCacheService.key(parts), JSON.stringify(value), 'EX', seconds)
      .catch((error: Error) =>
        this.logger.warn(`analytics cache write failed: ${error.message}`),
      );
  }
}
