import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ORGANIZATION_TYPES,
  PRIORITY_TIERS,
  PROBLEM_CATEGORIES,
  PROBLEM_SEARCH_SORTS,
  PROBLEM_SEVERITIES,
  PROBLEM_STATUSES,
  PROBLEM_URGENCIES,
  SEARCH_ENTITY_TYPES,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MAX_RADIUS_KM,
  SEARCH_PAGE_LIMIT_DEFAULT,
  SEARCH_PAGE_LIMIT_MAX,
  type OrganizationType,
  type PriorityTier,
  type ProblemCategory,
  type ProblemSearchSort,
  type ProblemSeverity,
  type ProblemStatus,
  type ProblemUrgency,
  type SearchEntityType,
} from '@samadhaan/shared';

const clean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || undefined : value;
const bool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : value;

/**
 * Search parameters (Prompt 25). Every one is validated here; none of them
 * grants access — the authorisation policy is applied inside each query.
 */
export class SearchBaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX_QUERY_LENGTH)
  @Transform(clean)
  q?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9+/=_-]{1,400}$/, { message: 'cursor is not valid' })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEARCH_PAGE_LIMIT_MAX)
  limit: number = SEARCH_PAGE_LIMIT_DEFAULT;

  /** false: search for the exact text, without reading filters from it. */
  @IsOptional()
  @Transform(bool)
  @IsIn([true, false])
  interpret: boolean = true;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class ProblemSearchDto extends SearchBaseDto {
  @IsOptional() @IsIn(PROBLEM_CATEGORIES) category?: ProblemCategory;

  @IsOptional() @IsString() @MaxLength(120) @Transform(clean) subcategory?: string;

  @IsOptional() @IsIn(PROBLEM_SEVERITIES) severity?: ProblemSeverity;

  @IsOptional() @IsIn(PROBLEM_URGENCIES) urgency?: ProblemUrgency;

  @IsOptional() @IsIn(PRIORITY_TIERS) priority?: PriorityTier;

  @IsOptional()
  @IsIn(PROBLEM_STATUSES.filter((s) => s !== 'DRAFT'))
  status?: ProblemStatus;

  @IsOptional() @Transform(bool) @IsIn([true, false]) verified?: boolean;

  @IsOptional() @Transform(bool) @IsIn([true, false]) resolved?: boolean;

  @IsOptional() @IsString() @MaxLength(100) @Transform(clean) city?: string;

  @IsOptional() @IsString() @MaxLength(100) @Transform(clean) state?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9 -]{3,12}$/, { message: 'postalCode is not valid' })
  postalCode?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(SEARCH_MAX_RADIUS_KM)
  radiusKm?: number;

  /** west,south,east,north */
  @IsOptional()
  @Matches(/^-?\d{1,3}(\.\d+)?,-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?,-?\d{1,2}(\.\d+)?$/, {
    message: 'bbox must be west,south,east,north',
  })
  bbox?: string;

  /** Problems an organisation has accepted (by its public slug). */
  @IsOptional()
  @Matches(/^[a-z0-9-]{2,80}$/, { message: 'organization must be a slug' })
  organization?: string;

  /** An official narrowing to their own office's jurisdiction. */
  @IsOptional()
  @Matches(/^[a-z0-9-]{2,80}$/, { message: 'office must be a slug' })
  office?: string;

  @IsOptional() @IsIn(PROBLEM_SEARCH_SORTS) sort: ProblemSearchSort = 'relevance';
}

export class OrganizationSearchDto extends SearchBaseDto {
  @IsOptional() @IsIn(ORGANIZATION_TYPES) organizationType?: OrganizationType;

  @IsOptional() @Transform(bool) @IsIn([true, false]) verified?: boolean;

  /** An expertise category. */
  @IsOptional() @IsIn(PROBLEM_CATEGORIES) expertise?: ProblemCategory;

  @IsOptional() @IsString() @MaxLength(100) @Transform(clean) city?: string;

  @IsOptional() @IsString() @MaxLength(100) @Transform(clean) state?: string;
}

export class KnowledgeSearchDto extends SearchBaseDto {
  /** Include this project's knowledge — only if the caller participates in it. */
  @IsOptional() @IsUUID() projectId?: string;

  @IsOptional() @IsIn(PROBLEM_CATEGORIES) category?: ProblemCategory;
}

export class ProjectSearchDto extends SearchBaseDto {
  @IsOptional()
  @IsIn(['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'])
  status?: string;
}

export class UnifiedSearchDto extends ProblemSearchDto {
  @IsOptional() @IsIn(SEARCH_ENTITY_TYPES) type?: SearchEntityType;

  @IsOptional() @IsIn(ORGANIZATION_TYPES) organizationType?: OrganizationType;
}

export class SuggestDto {
  @IsString()
  @MaxLength(100)
  @Transform(clean)
  q!: string;
}
