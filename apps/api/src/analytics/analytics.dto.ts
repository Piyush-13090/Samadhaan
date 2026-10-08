import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  ANALYTICS_EXPORT_DATASETS,
  ANALYTICS_PRESETS,
  PRIORITY_TIERS,
  PROBLEM_CATEGORIES,
  PROBLEM_SEVERITIES,
  PROBLEM_STATUSES,
  type AnalyticsExportDataset,
  type AnalyticsPreset,
  type PriorityTier,
  type ProblemCategory,
  type ProblemSeverity,
  type ProblemStatus,
} from '@samadhaan/shared';

const clean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || undefined : value;

/**
 * Period and filters for every analytics read. Filters only narrow what the
 * caller's scope (jurisdiction, organisation, self) already allows; none of
 * them grants anything.
 */
export class AnalyticsPeriodDto {
  @IsOptional()
  @IsIn(ANALYTICS_PRESETS)
  preset?: AnalyticsPreset;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  /** IANA zone, validated in resolvePeriod. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(clean)
  timezone?: string;
}

export class AnalyticsQueryDto extends AnalyticsPeriodDto {
  @IsOptional()
  @IsIn(PROBLEM_CATEGORIES)
  category?: ProblemCategory;

  @IsOptional()
  @IsIn(PROBLEM_SEVERITIES)
  severity?: ProblemSeverity;

  @IsOptional()
  @IsIn(PROBLEM_STATUSES.filter((s) => s !== 'DRAFT'))
  status?: ProblemStatus;

  @IsOptional()
  @IsIn(PRIORITY_TIERS)
  priority?: PriorityTier;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(clean)
  city?: string;

  /** A postal code. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9 -]+$/, { message: 'area must be a postal code' })
  @Transform(clean)
  area?: string;
}

export class AnalyticsExportDto extends AnalyticsQueryDto {
  @IsIn(ANALYTICS_EXPORT_DATASETS)
  dataset!: AnalyticsExportDataset;

  @IsOptional()
  @IsIn(['csv', 'json'])
  format: 'csv' | 'json' = 'csv';
}
