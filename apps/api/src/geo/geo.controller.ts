import { Controller, Get, Query } from '@nestjs/common';
import { API_VERSION, type GeocodeResult } from '@samadhaan/shared';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { GeocodeSearchQueryDto, ReverseGeocodeQueryDto } from './dto/geocode.dto.js';
import { GeocodingService } from './geocoding.service.js';

/**
 * Geocoding for the map and the report location picker.
 *
 * **Requires a session**, unlike the map data itself. These routes spend a
 * third party's rate limit on every cache miss; left public, they would be a
 * free geocoding proxy for anyone on the internet. Rate limited per user on
 * top, generously enough for typing into a search box.
 */
@Controller({ path: 'geo', version: API_VERSION.replace('v', '') })
export class GeoController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Get('search')
  @UserRateLimit({ bucket: 'geocode', max: 30, windowSeconds: 60 })
  search(@Query() query: GeocodeSearchQueryDto): Promise<GeocodeResult[]> {
    return this.geocoding.search(query.q, query.limit);
  }

  /** `null` when there is no address at that point — open water, say. */
  @Get('reverse')
  @UserRateLimit({ bucket: 'geocode', max: 30, windowSeconds: 60 })
  reverse(@Query() query: ReverseGeocodeQueryDto): Promise<GeocodeResult | null> {
    return this.geocoding.reverse(query.latitude, query.longitude);
  }
}
