import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  MAP_FEATURE_DEFAULT_LIMIT,
  MAP_FEATURE_MAX_LIMIT,
  MAP_FILTER_STATUSES,
  PROBLEM_CATEGORIES,
  PROBLEM_SEVERITIES,
  type MapFilterStatus,
  type ProblemCategory,
  type ProblemSeverity,
} from '@samadhaan/shared';

/**
 * A map viewport plus filters.
 *
 * The four edges are required, so there is no way to ask for "everything":
 * every map query is bounded by a box, and the service then bounds the box
 * itself (see `assertViewport`). Each edge is range-checked here; their
 * relationship — south below north, a span the endpoint allows — is checked by
 * the service, which knows which endpoint's limit applies.
 */
/**
 * The viewport alone. Shared by the public map and the government map, which
 * differ only in the filters they accept.
 */
export class MapBoxDto {
  @IsDefined({ message: 'west is required' })
  @Type(() => Number)
  @IsLongitude({ message: 'west must be a longitude between -180 and 180' })
  west!: number;

  @IsDefined({ message: 'south is required' })
  @Type(() => Number)
  @IsLatitude({ message: 'south must be a latitude between -90 and 90' })
  south!: number;

  @IsDefined({ message: 'east is required' })
  @Type(() => Number)
  @IsLongitude({ message: 'east must be a longitude between -180 and 180' })
  east!: number;

  @IsDefined({ message: 'north is required' })
  @Type(() => Number)
  @IsLatitude({ message: 'north must be a latitude between -90 and 90' })
  north!: number;
}

export class MapViewportQueryDto extends MapBoxDto {
  @IsOptional()
  @IsIn(PROBLEM_CATEGORIES)
  category?: ProblemCategory;

  /** The problem's recorded severity — not the AI's estimate. */
  @IsOptional()
  @IsIn(PROBLEM_SEVERITIES)
  severity?: ProblemSeverity;

  /**
   * Only statuses a citizen can meaningfully browse. Without one, the map shows
   * live work, like the discovery feed.
   */
  @IsOptional()
  @IsIn(MAP_FILTER_STATUSES)
  status?: MapFilterStatus;
}

function hasEitherOrigin(query: MapProblemsQueryDto): boolean {
  return query.originLatitude !== undefined || query.originLongitude !== undefined;
}

/** Individual problems in a viewport. */
export class MapProblemsQueryDto extends MapViewportQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAP_FEATURE_MAX_LIMIT)
  limit: number = MAP_FEATURE_DEFAULT_LIMIT;

  /**
   * Where to measure `distanceMeters` from — the viewer's chosen location.
   * Optional and all-or-nothing, like the discovery feed's coordinates. It
   * never filters, and it is never stored.
   */
  @ValidateIf(hasEitherOrigin)
  @IsDefined({ message: 'originLongitude is required when originLatitude is given' })
  @Type(() => Number)
  @IsLatitude()
  originLatitude?: number;

  @ValidateIf(hasEitherOrigin)
  @IsDefined({ message: 'originLatitude is required when originLongitude is given' })
  @Type(() => Number)
  @IsLongitude()
  originLongitude?: number;
}

/** Aggregated cells over a (larger) viewport. */
export class MapAggregateQueryDto extends MapViewportQueryDto {}
