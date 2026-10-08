import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
} from 'class-validator';
import {
  IMPACT_ADJUSTMENT_MAX,
  IMPACT_FILTERS,
  LEADERBOARD_PERIODS,
  PROBLEM_CATEGORIES,
  type ImpactFilter,
  type LeaderboardPeriod,
  type ProblemCategory,
} from '@samadhaan/shared';

const clean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || undefined : value;

export class ImpactHistoryQueryDto {
  @IsOptional()
  @IsIn(IMPACT_FILTERS)
  filter: ImpactFilter = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class LeaderboardQueryDto {
  @IsOptional()
  @IsIn(LEADERBOARD_PERIODS)
  period: LeaderboardPeriod = 'month';

  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Transform(clean)
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsIn(PROBLEM_CATEGORIES)
  category?: ProblemCategory;

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
  @Max(50)
  limit: number = 20;
}

/** An administrator's correction. The target comes from the URL; nothing else is accepted. */
export class ImpactAdjustmentDto {
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  @Min(-IMPACT_ADJUSTMENT_MAX)
  @Max(IMPACT_ADJUSTMENT_MAX)
  amount!: number;

  @IsDefined({ message: 'Give a reason for the adjustment.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10, { message: 'Give a reason of at least 10 characters.' })
  @MaxLength(500)
  reason!: string;
}
