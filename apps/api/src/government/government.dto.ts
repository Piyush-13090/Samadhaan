import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  AI_STATUS_FILTERS,
  DUPLICATE_FILTERS,
  GOVERNMENT_PAGE_LIMIT_DEFAULT,
  GOVERNMENT_PAGE_LIMIT_MAX,
  GOVERNMENT_SORTS,
  GOVERNMENT_STATUS_FILTERS,
  ALLOCATION_NOTE_MAX_LENGTH,
  INTERNAL_NOTE_MAX_LENGTH,
  MAP_FEATURE_DEFAULT_LIMIT,
  MAP_FEATURE_MAX_LIMIT,
  PROBLEM_CATEGORIES,
  PROBLEM_SEVERITIES,
  PROBLEM_STATUSES,
  REVIEW_NOTE_MAX_LENGTH,
  TREND_RANGES,
  type AiStatusFilter,
  type DuplicateFilter,
  type GovernmentSort,
  type GovernmentStatusFilter,
  type ProblemCategory,
  type ProblemSeverity,
  type ProblemStatus,
  type TrendRange,
} from '@samadhaan/shared';
import { MapBoxDto } from '../problems/dto/map-query.dto.js';

const clean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || undefined : value;

export class DashboardQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn(TREND_RANGES)
  range: TrendRange = 30;
}

/**
 * Review queue and problem list filters. No organisation, jurisdiction or
 * city here grants anything: they only narrow what the office's jurisdiction
 * already allows.
 */
export class GovernmentProblemsQueryDto {
  @IsOptional()
  @IsIn(['queue', 'all'])
  view: 'queue' | 'all' = 'queue';

  @IsOptional()
  @IsIn(GOVERNMENT_STATUS_FILTERS)
  status?: GovernmentStatusFilter;

  @IsOptional()
  @IsIn(PROBLEM_SEVERITIES)
  severity?: ProblemSeverity;

  @IsOptional()
  @IsIn(PROBLEM_CATEGORIES)
  category?: ProblemCategory;

  @IsOptional()
  @Transform(clean)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  subcategory?: string;

  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(120)
  city?: string;

  /** Words in the address, e.g. a sector or locality. */
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  area?: string;

  @IsOptional()
  @IsDateString({}, { message: 'reportedFrom must be an ISO date' })
  reportedFrom?: string;

  @IsOptional()
  @IsDateString({}, { message: 'reportedTo must be an ISO date' })
  reportedTo?: string;

  @IsOptional()
  @IsIn(DUPLICATE_FILTERS)
  duplicate?: DuplicateFilter;

  @IsOptional()
  @IsIn(AI_STATUS_FILTERS)
  aiStatus?: AiStatusFilter;

  /** Basic search: reference, title, description, address, category. */
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(GOVERNMENT_SORTS)
  sort: GovernmentSort = 'queue';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(GOVERNMENT_PAGE_LIMIT_MAX)
  limit: number = GOVERNMENT_PAGE_LIMIT_DEFAULT;
}

/** A review decision. Which ones are allowed is decided server-side. */
export class StatusTransitionDto {
  @IsDefined()
  @IsIn(PROBLEM_STATUSES)
  status!: ProblemStatus;

  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(REVIEW_NOTE_MAX_LENGTH)
  note?: string;
}

export class InternalNoteDto {
  @IsDefined()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(INTERNAL_NOTE_MAX_LENGTH)
  body!: string;
}

/** The government map: the public viewport plus review filters. */
export class GovernmentMapQueryDto extends MapBoxDto {
  @IsOptional()
  @IsIn(PROBLEM_CATEGORIES)
  category?: ProblemCategory;

  @IsOptional()
  @IsIn(PROBLEM_SEVERITIES)
  severity?: ProblemSeverity;

  @IsOptional()
  @IsIn(GOVERNMENT_STATUS_FILTERS)
  status?: GovernmentStatusFilter;

  @IsOptional()
  @IsIn(DUPLICATE_FILTERS)
  duplicate?: DuplicateFilter;

  @IsOptional()
  @IsIn(AI_STATUS_FILTERS)
  aiStatus?: AiStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30, 90])
  reportedWithinDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAP_FEATURE_MAX_LIMIT)
  limit: number = MAP_FEATURE_DEFAULT_LIMIT;
}

/**
 * An allocation request. The office and the official come from the session;
 * `organizationId` names the target and is checked against the database.
 */
export class CreateAllocationDto {
  @IsDefined()
  @IsUUID()
  organizationId!: string;

  /** Shared with the organisation. */
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(ALLOCATION_NOTE_MAX_LENGTH)
  instructions?: string;

  /** Why this organisation — government-only. */
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(ALLOCATION_NOTE_MAX_LENGTH)
  internalReason?: string;
}

export class CancelAllocationDto {
  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(ALLOCATION_NOTE_MAX_LENGTH)
  reason?: string;
}

export class CandidateSearchDto {
  @IsDefined()
  @Transform(clean)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  q!: string;
}
