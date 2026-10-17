import { Injectable } from '@nestjs/common';
import type { SearchMetrics } from '@samadhaan/shared';
import { AppConfig } from '../config/app.config.js';
import { RedisService } from '../redis/redis.service.js';

/** Queries that look like personal data are never stored: emails, long numbers. */
export function looksSensitive(query: string): boolean {
  return (
    /@/.test(query) ||
    /\d{8,}/.test(query.replace(/[\s-]/g, '')) ||
    /\b[A-Z]{5}\d{4}[A-Z]\b/i.test(query)
  );
}

const METRIC_TTL_SECONDS = 35 * 86_400;

export interface SearchEvent {
  type: string;
  results: number;
  latencyMs: number;
  semantic: boolean;
  ai: boolean;
  filters: string[];
}

/**
 * Recent searches and search telemetry (Prompt 25).
 *
 * Recent searches: per user, in Redis, at most SEARCH_RECENT_MAX entries,
 * expiring SEARCH_RECENT_DAYS after the last search. Only submitted searches
 * are kept (never keystrokes), and nothing that looks like personal data.
 * The user can clear them at any time.
 *
 * Telemetry: daily counters only — query count, zero-result count, entity
 * type, latency band, which filters were used, whether semantic or AI parsing
 * ran. **No query text and no user** is ever recorded. Kept 35 days.
 */
@Injectable()
export class SearchHistoryService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  private key(userId: string) {
    return `search:recent:v1:${userId}`;
  }

  async recent(userId: string): Promise<string[]> {
    return (
      (await this.redis.connection
        .lrange(this.key(userId), 0, this.config.search.recentMax - 1)
        .catch(() => [])) ?? []
    );
  }

  async remember(userId: string, query: string): Promise<void> {
    const max = this.config.search.recentMax;
    const q = query.trim().replace(/\s+/g, ' ').slice(0, 100);
    if (max === 0 || q.length < 2 || looksSensitive(q)) return;
    const key = this.key(userId);
    await this.redis.connection
      .multi()
      .lrem(key, 0, q)
      .lpush(key, q)
      .ltrim(key, 0, max - 1)
      .expire(key, this.config.search.recentDays * 86_400)
      .exec()
      .catch(() => undefined);
  }

  async clear(userId: string): Promise<void> {
    await this.redis.connection.del(this.key(userId)).catch(() => undefined);
  }

  async record(event: SearchEvent): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const key = `search:metrics:v1:${day}`;
    const band =
      event.latencyMs < 100
        ? 'lt100'
        : event.latencyMs < 300
          ? 'lt300'
          : event.latencyMs < 1000
            ? 'lt1000'
            : 'ge1000';
    const multi = this.redis.connection
      .multi()
      .hincrby(key, 'queries', 1)
      .hincrby(key, `type:${event.type}`, 1)
      .hincrby(key, `latency:${band}`, 1);
    if (event.results === 0) multi.hincrby(key, 'zeroResults', 1);
    if (event.semantic) multi.hincrby(key, 'semanticUsed', 1);
    if (event.ai) multi.hincrby(key, 'aiParsed', 1);
    for (const filter of event.filters.slice(0, 20))
      multi.hincrby(key, `filter:${filter}`, 1);
    await multi
      .expire(key, METRIC_TTL_SECONDS)
      .exec()
      .catch(() => undefined);
  }

  async metrics(days = 14): Promise<SearchMetrics> {
    const out: SearchMetrics['days'] = [];
    for (let i = 0; i < Math.min(days, 35); i++) {
      const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const hash: Record<string, string> =
        (await this.redis.connection
          .hgetall(`search:metrics:v1:${date}`)
          .catch(() => null)) ?? {};
      const pick = (prefix: string) =>
        Object.fromEntries(
          Object.entries(hash)
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, v]) => [k.slice(prefix.length), Number(v)]),
        );
      out.push({
        date,
        queries: Number(hash.queries ?? 0),
        zeroResults: Number(hash.zeroResults ?? 0),
        semanticUsed: Number(hash.semanticUsed ?? 0),
        aiParsed: Number(hash.aiParsed ?? 0),
        byType: pick('type:'),
        latency: pick('latency:'),
        filters: pick('filter:'),
      });
    }
    return { days: out };
  }
}
