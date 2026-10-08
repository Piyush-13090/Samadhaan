import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PRIORITY_OVERRIDE_REASON_MAX,
  PRIORITY_OVERRIDE_REASON_MIN,
  PRIORITY_TIERS,
  type PriorityTier,
} from '@samadhaan/shared';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** A government priority decision. The reason is required. */
export class PriorityOverrideDto {
  @IsDefined()
  @IsIn(PRIORITY_TIERS)
  tier!: PriorityTier;

  @IsDefined({ message: 'Give a reason for the priority you set.' })
  @Transform(trim)
  @IsString()
  @MinLength(PRIORITY_OVERRIDE_REASON_MIN, {
    message: `Give a reason of at least ${PRIORITY_OVERRIDE_REASON_MIN} characters.`,
  })
  @MaxLength(PRIORITY_OVERRIDE_REASON_MAX)
  reason!: string;
}

export class RemoveOverrideDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(PRIORITY_OVERRIDE_REASON_MAX)
  reason?: string;
}

export class RecalculateDto {
  /** Ask the AI service again even if the report is unchanged. */
  @IsOptional()
  @IsBoolean()
  refreshAi?: boolean;
}
