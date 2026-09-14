import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  DEFAULT_DISCOVERY_RADIUS_METERS,
  DISCOVERY_SORTS,
  MAX_DISCOVERY_RADIUS_METERS,
  PROBLEM_CATEGORIES,
  PROBLEM_STATUSES,
  type DiscoverySort,
  type ProblemCategory,
  type ProblemStatus,
} from '@samadhaan/shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

/**
 * True once either coordinate is present, which is what makes both required.
 *
 * Validating each half only when the *other* is present is the tempting
 * spelling and is wrong: with a single coordinate neither rule runs, and the
 * request quietly degrades to a citywide feed that looks like a nearby one.
 */
function hasEitherCoordinate(query: DiscoverProblemsQueryDto): boolean {
  return query.latitude !== undefined || query.longitude !== undefined;
}

/**
 * Query for the discovery feed.
 *
 * Two search modes, and exactly one applies:
 *
 *  - **Coordinates** — `latitude` + `longitude`, with a bounded `radiusMeters`.
 *    Ranked by real PostGIS distance.
 *  - **City** — the fallback when no coordinates are available. Profiles store
 *    city and state but deliberately not coordinates (a civic platform locates
 *    *problems* precisely, not people), so this is the honest degradation
 *    rather than guessing a centroid.
 *
 * With neither, the feed is the whole public list, newest first.
 */
export class DiscoverProblemsQueryDto extends PaginationQueryDto {
  /**
   * Latitude and longitude are all-or-nothing: half a coordinate pair is a
   * client bug, and silently ignoring it would return a citywide feed that
   * looks like a nearby one.
   */
  @ValidateIf(hasEitherCoordinate)
  @IsDefined({ message: 'longitude is required when latitude is given' })
  @Type(() => Number)
  @IsLatitude({ message: 'latitude must be a valid latitude between -90 and 90' })
  latitude?: number;

  @ValidateIf(hasEitherCoordinate)
  @IsDefined({ message: 'latitude is required when longitude is given' })
  @Type(() => Number)
  @IsLongitude({ message: 'longitude must be a valid longitude between -180 and 180' })
  longitude?: number;

  /**
   * Search radius in metres.
   *
   * Bounded at both ends. Without an upper bound, a caller could ask for a
   * radius covering the country and turn a bounded index lookup into a full
   * scan on every request.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  @Max(MAX_DISCOVERY_RADIUS_METERS)
  radiusMeters: number = DEFAULT_DISCOVERY_RADIUS_METERS;

  /** City fallback, used only when no coordinates are supplied. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsIn(PROBLEM_CATEGORIES)
  category?: ProblemCategory;

  /**
   * Status filter. Omitted means "live work only" — a feed led by resolved and
   * archived reports would answer the wrong question for someone asking what
   * needs attention.
   */
  @IsOptional()
  @IsIn(PROBLEM_STATUSES)
  status?: ProblemStatus;

  @IsOptional()
  @IsIn(DISCOVERY_SORTS)
  sort: DiscoverySort = 'relevance';

  /** Tighter than the shared default: a discovery feed is browsed, not bulk-read. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  override limit: number = 20;
}
