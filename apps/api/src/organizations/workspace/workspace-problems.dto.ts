import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ALLOCATION_NOTE_MAX_LENGTH,
  ALLOCATION_VIEWS,
  MAP_FILTER_STATUSES,
  type AllocationView,
  MAX_DISCOVERY_RADIUS_METERS,
  PROBLEM_CATEGORIES,
  PROBLEM_SEVERITIES,
  REPORTED_WITHIN_OPTIONS,
  WORKSPACE_PROBLEM_SCOPES,
  WORKSPACE_PROBLEM_SORTS,
  WORKSPACE_PROBLEMS_DEFAULT_LIMIT,
  WORKSPACE_PROBLEMS_MAX_LIMIT,
  WORKSPACE_PROBLEMS_MAX_PAGE,
  RECOMMENDATION_SORTS,
  RECOMMENDATION_VIEWS,
  type RecommendationSort,
  type RecommendationView,
  type MapFilterStatus,
  type ProblemCategory,
  type ProblemSeverity,
  type ReportedWithinDays,
  type WorkspaceProblemScope,
  type WorkspaceProblemSort,
} from '@samadhaan/shared';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || undefined : value;

/**
 * Query for `GET /organizations/:slug/problems`.
 *
 * Every filter is validated against the shared taxonomy, so the SQL only ever
 * sees values from a closed list or a bounded string. There is deliberately no
 * `organizationId` here: the organisation is the one in the path, proven by
 * the workspace guard.
 */
export class WorkspaceProblemsQueryDto {
  @IsOptional()
  @IsIn(WORKSPACE_PROBLEM_SCOPES)
  scope: WorkspaceProblemScope = 'all';

  @IsOptional()
  @IsIn(WORKSPACE_PROBLEM_SORTS)
  sort: WorkspaceProblemSort = 'relevance';

  @IsOptional()
  @IsIn(PROBLEM_CATEGORIES)
  category?: ProblemCategory;

  /** Free text within the category, matched literally (wildcards escaped). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  subcategory?: string;

  @IsOptional()
  @IsIn(PROBLEM_SEVERITIES)
  severity?: ProblemSeverity;

  /** The citizen-facing statuses. Omitted means live work only. */
  @IsOptional()
  @IsIn(MAP_FILTER_STATUSES)
  status?: MapFilterStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  city?: string;

  /** Distance from the organisation's registered location, in metres. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(500)
  @Max(MAX_DISCOVERY_RADIUS_METERS)
  radiusMeters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn(REPORTED_WITHIN_OPTIONS)
  reportedWithinDays?: ReportedWithinDays;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WORKSPACE_PROBLEMS_MAX_PAGE)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WORKSPACE_PROBLEMS_MAX_LIMIT)
  limit: number = WORKSPACE_PROBLEMS_DEFAULT_LIMIT;
}

/**
 * Query for `GET /organizations/:slug/recommendations`.
 *
 * The same taxonomy-checked filters as problem discovery, plus a minimum
 * relevance. As everywhere in the workspace, no organisation id: it is the
 * one in the path.
 */
export class RecommendationsQueryDto {
  @IsOptional()
  @IsIn(RECOMMENDATION_SORTS)
  sort: RecommendationSort = 'relevance';

  @IsOptional()
  @IsIn(RECOMMENDATION_VIEWS)
  view: RecommendationView = 'active';

  @IsOptional()
  @IsIn(PROBLEM_CATEGORIES)
  category?: ProblemCategory;

  @IsOptional()
  @IsIn(PROBLEM_SEVERITIES)
  severity?: ProblemSeverity;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(500)
  @Max(MAX_DISCOVERY_RADIUS_METERS)
  radiusMeters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn(REPORTED_WITHIN_OPTIONS)
  reportedWithinDays?: ReportedWithinDays;

  /** 0–1. Only matches at least this relevant. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minRelevance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WORKSPACE_PROBLEMS_MAX_PAGE)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WORKSPACE_PROBLEMS_MAX_LIMIT)
  limit: number = WORKSPACE_PROBLEMS_DEFAULT_LIMIT;
}

/** The organisation's allocation inbox. */
export class AllocationListQueryDto {
  @IsOptional()
  @IsIn(ALLOCATION_VIEWS)
  view: AllocationView = 'pending';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WORKSPACE_PROBLEMS_MAX_PAGE)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WORKSPACE_PROBLEMS_MAX_LIMIT)
  limit: number = WORKSPACE_PROBLEMS_DEFAULT_LIMIT;
}

export class AcceptAllocationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(ALLOCATION_NOTE_MAX_LENGTH)
  note?: string;
}

/** A decline must say why; the allocating office reads it to reallocate. */
export class DeclineAllocationDto {
  @IsDefined({ message: 'Give a reason for declining.' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Give a reason for declining.' })
  @MaxLength(ALLOCATION_NOTE_MAX_LENGTH)
  reason!: string;
}
