import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { GeocodeResult } from '@samadhaan/shared';
import { AppException } from '../common/app.exception.js';
import { RedisService } from '../redis/redis.service.js';
import { GeocodingProvider, GeocodingUnavailableError } from './geocoding.provider.js';

/** Places do not move. A day is long enough to absorb repeat lookups. */
const CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Reverse lookups are cached on a ~11 m grid (four decimals). Two taps a few
 * metres apart get the same street; the provider is asked once.
 */
const REVERSE_PRECISION = 4;

/**
 * Location search and reverse geocoding, for the map search box and the report
 * location picker.
 *
 * **Server-side only.** The browser calls the API; the API calls the provider.
 * That keeps any provider key off the client, lets one cache serve everyone,
 * and puts the provider's rate limit behind ours.
 *
 * **Redis earns its place here**: the same handful of localities are searched
 * over and over, the provider is slow and rate-limited, and a cache miss costs
 * a second. Queries are hashed into keys, so the cache never holds raw search
 * text in key names. A Redis outage only costs the cache.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  constructor(
    private readonly provider: GeocodingProvider,
    private readonly redis: RedisService,
  ) {}

  async search(rawQuery: string, limit = 5): Promise<GeocodeResult[]> {
    const query = rawQuery.trim().replace(/\s+/g, ' ');
    const key = `geo:search:${this.provider.name}:${hash(query.toLowerCase())}:${limit}`;

    return this.cached(key, () => this.provider.search(query, limit));
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodeResult | null> {
    const lat = latitude.toFixed(REVERSE_PRECISION);
    const lng = longitude.toFixed(REVERSE_PRECISION);
    const key = `geo:reverse:${this.provider.name}:${lat}:${lng}`;

    return this.cached(key, () => this.provider.reverse(Number(lat), Number(lng)));
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.readCache<T>(key);
    if (hit !== undefined) return hit;

    let value: T;
    try {
      value = await load();
    } catch (error) {
      if (error instanceof GeocodingUnavailableError) {
        this.logger.warn(`Geocoding unavailable: ${error.message}`);
        throw AppException.upstreamUnavailable(
          'Location search',
          "Location search isn't available right now. You can still move the map or enter the address yourself.",
        );
      }
      throw error;
    }

    await this.writeCache(key, value);
    return value;
  }

  private async readCache<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.connection.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  private async writeCache(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.connection.set(
        key,
        JSON.stringify(value),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch {
      // A cache that cannot be written is a slower request, not a failed one.
    }
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
