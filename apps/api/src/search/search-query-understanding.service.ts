import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { SearchUnderstanding } from '@samadhaan/shared';
import { AiService } from '../ai/ai.service.js';
import type { AiSearchUnderstanding } from '../ai/dto/search.dto.js';
import { addDays, localDate } from '../analytics/analytics-time.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import {
  intentFor,
  parseSearchQuery,
  type ParsedFilters,
  type ParsedQuery,
} from './search-query-parser.js';

const CITY_CACHE_KEY = 'search:cities:v1';
const CITY_CACHE_SECONDS = 600;
const AI_CACHE_SECONDS = 86_400;

const label = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * Query understanding (Prompt 25): rules first, AI only as a fallback.
 *
 * The AI is called only when the rules found nothing in a query that reads
 * like natural language ("where are people complaining about…"), only for a
 * full search (never suggestions), within a per-user hourly budget, and
 * cached by the query text. Its output passes the same validation as the
 * rules': taxonomy enums, known cities, fixed time ranges. If it fails,
 * search proceeds with the plain text.
 */
@Injectable()
export class SearchQueryUnderstandingService {
  private readonly logger = new Logger(SearchQueryUnderstandingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ai: AiService,
    private readonly config: AppConfig,
  ) {}

  /** Known city names, lowercase → display, from published problems and organisations. */
  async cities(): Promise<Map<string, string>> {
    const hit = await this.redis.connection.get(CITY_CACHE_KEY).catch(() => null);
    if (hit) {
      try {
        return new Map(JSON.parse(hit) as Array<[string, string]>);
      } catch {
        // rebuild
      }
    }
    const rows = await this.prisma.$queryRaw<Array<{ key: string; name: string }>>`
      SELECT lower(trim(city)) AS key, min(trim(city)) AS name FROM (
        SELECT city FROM problems WHERE "deletedAt" IS NULL AND status <> 'DRAFT' AND city IS NOT NULL
        UNION ALL
        SELECT city FROM organizations WHERE "deletedAt" IS NULL AND city IS NOT NULL
      ) c
      WHERE length(trim(city)) BETWEEN 2 AND 60
      GROUP BY 1
      ORDER BY count(*) DESC
      LIMIT 500
    `;
    const entries = rows.map((r) => [r.key, r.name] as [string, string]);
    await this.redis.connection
      .set(CITY_CACHE_KEY, JSON.stringify(entries), 'EX', CITY_CACHE_SECONDS)
      .catch(() => undefined);
    return new Map(entries);
  }

  async understand(
    q: string,
    options: { userId: string; hasOrigin: boolean; allowAi: boolean; timezone: string },
  ): Promise<{ parsed: ParsedQuery; view: SearchUnderstanding }> {
    const cities = await this.cities();
    const parsed = parseSearchQuery(q, {
      cities,
      timezone: options.timezone,
      hasOrigin: options.hasOrigin,
    });
    let source: SearchUnderstanding['source'] =
      parsed.applied.length > 0 || parsed.entityType ? 'rules' : 'none';

    if (parsed.ambiguous && options.allowAi && this.config.search.aiParseEnabled) {
      const ai = await this.aiReading(q, options.userId);
      if (ai && ai.aiRan && ai.confidence >= 0.5) {
        this.merge(parsed, ai, cities, options.timezone);
        if (parsed.applied.length > 0 || parsed.entityType) source = 'ai';
      }
    }

    return {
      parsed,
      view: {
        intent: intentFor(parsed.entityType),
        entityType: parsed.entityType,
        applied: parsed.applied,
        text: parsed.text,
        needsLocation: parsed.needsLocation,
        source,
        confidence: source === 'ai' ? 0.6 : parsed.confidence,
      },
    };
  }

  private async aiReading(
    q: string,
    userId: string,
  ): Promise<AiSearchUnderstanding | null> {
    const hash = createHash('sha256').update(q.trim().toLowerCase()).digest('hex');
    const cacheKey = `search:aiparse:v1:${hash}`;
    const cached = await this.redis.connection.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as AiSearchUnderstanding;
      } catch {
        // re-ask
      }
    }
    // A per-user hourly budget: the expensive path is never unbounded.
    const budgetKey = `search:aiparse:budget:${userId}:${Math.floor(Date.now() / 3_600_000)}`;
    const used = await this.redis.connection
      .incr(budgetKey)
      .catch(() => Number.POSITIVE_INFINITY);
    if (used === 1)
      await this.redis.connection.expire(budgetKey, 3600).catch(() => undefined);
    if (used > this.config.search.aiParsePerHour) return null;

    try {
      const result = await this.ai.understandSearch(q);
      if (result) {
        await this.redis.connection
          .set(cacheKey, JSON.stringify(result), 'EX', AI_CACHE_SECONDS)
          .catch(() => undefined);
      }
      return result;
    } catch (error) {
      this.logger.warn(`AI query understanding failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** Adds AI-read filters the rules did not set, validated like the rules'. */
  private merge(
    parsed: ParsedQuery,
    ai: AiSearchUnderstanding,
    cities: Map<string, string>,
    timezone: string,
  ): void {
    const f: ParsedFilters = parsed.filters;
    const push = (filter: string, value: string, text: string) =>
      parsed.applied.push({ filter, value, label: text });
    parsed.entityType ??= ai.entityType;
    if (ai.category && !f.category) {
      f.category = ai.category;
      push('category', ai.category, label(ai.category));
    }
    if (ai.severity && !f.severity) {
      f.severity = ai.severity;
      push('severity', ai.severity, label(ai.severity));
    }
    if (ai.status && !f.status) {
      f.status = ai.status;
      push('status', ai.status, label(ai.status));
    }
    const city = ai.city ? cities.get(ai.city.toLowerCase()) : undefined;
    if (city && !f.city) {
      f.city = city;
      push('city', city, city);
    }
    if (ai.organizationType && !f.organizationType) {
      f.organizationType = ai.organizationType;
      push('organizationType', ai.organizationType, label(ai.organizationType));
    }
    if (ai.timeRange && !f.from) {
      const today = localDate(new Date(), timezone);
      const ranges = {
        today: [today, 'Today'],
        last_7_days: [addDays(today, -6), 'Past 7 days'],
        last_30_days: [addDays(today, -29), 'Last 30 days'],
        this_month: [`${today.slice(0, 7)}-01`, 'This month'],
        this_year: [`${today.slice(0, 4)}-01-01`, 'This year'],
      } as const;
      const [from, text] = ranges[ai.timeRange];
      f.from = from;
      f.to = today;
      push('dateRange', `${from}..${today}`, text);
    }
    if (ai.semanticQuery) parsed.text = ai.semanticQuery;
  }
}
