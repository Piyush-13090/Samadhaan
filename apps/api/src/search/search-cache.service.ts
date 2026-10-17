import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app.config.js';
import { RedisService } from '../redis/redis.service.js';

export interface CachedEntry {
  id: string;
  score: number;
  explanation: string[];
}

export interface CachedList {
  entries: CachedEntry[];
  match: 'exact' | 'related' | 'none';
  signals: string[];
}

/**
 * Ranked result lists (Prompt 25), cached so later pages read the same order.
 *
 * The key hashes the authorisation scope with everything that decides the
 * results — query text, effective filters, place, sort, time zone. A public
 * scope ("public") is shared; a private one embeds the user, so one person's
 * results are never served to another. A cursor names its list key, and the
 * server only honours it if it equals the key it computes for the request.
 */
@Injectable()
export class SearchCacheService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  key(parts: unknown): string {
    return `search:list:v1:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
  }

  async get(key: string): Promise<CachedList | null> {
    if (this.config.search.cacheSeconds <= 0) return null;
    const hit = await this.redis.connection.get(key).catch(() => null);
    if (!hit) return null;
    try {
      return JSON.parse(hit) as CachedList;
    } catch {
      return null;
    }
  }

  async set(key: string, list: CachedList): Promise<void> {
    const ttl = this.config.search.cacheSeconds;
    if (ttl <= 0) return;
    await this.redis.connection
      .set(key, JSON.stringify(list), 'EX', ttl)
      .catch(() => undefined);
  }
}
