import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { err, ok, toErrorMessage, type Result } from '@samadhaan/shared';
import { AppConfig } from '../config/app.config.js';

/**
 * Owns the shared Redis connection.
 *
 * Redis backs caching, rate limiting, background job queues, notification
 * fan-out and AI processing queues in later milestones. Only the connection is
 * established here; no queue or cache semantics are implemented yet.
 *
 * `lazyConnect` plus a bounded retry strategy means an unavailable Redis
 * degrades the health report instead of blocking or crashing startup.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(config: AppConfig) {
    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (attempt: number) => Math.min(attempt * 500, 5_000),
    });

    // ioredis emits `error` on every reconnect attempt; without a listener an
    // unavailable Redis would take the process down with an unhandled event.
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
  }

  /** The raw client, for modules that need queues or pub/sub later. */
  get connection(): Redis {
    return this.client;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Connected to Redis');
    } catch (error) {
      this.logger.error(`Initial Redis connection failed: ${toErrorMessage(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }

  /** Cheap liveness probe used by the health module. Never throws. */
  async ping(): Promise<Result<true>> {
    try {
      const reply = await this.client.ping();
      return reply === 'PONG' ? ok(true) : err(new Error(`Unexpected reply: ${reply}`));
    } catch (error) {
      return err(new Error(toErrorMessage(error)));
    }
  }
}
