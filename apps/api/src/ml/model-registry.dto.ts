import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { ModelTask } from '../generated/prisma/client.js';
import { MODEL_TASKS } from './ml-tasks.js';

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/**
 * Registration body (Prompt 28). Produced by `python -m ml registration
 * --artifact <dir>` from the training run's manifest — not typed by hand.
 */
export class RegisterModelDto {
  @IsIn(MODEL_TASKS)
  task!: ModelTask;

  @Matches(SAFE_ID, { message: 'version must match [a-z0-9][a-z0-9._-]*' })
  version!: string;

  @IsIn(['tfidf-softmax-v1', 'signals-logistic-v1'])
  modelFormat!: string;

  @IsString()
  @MaxLength(140)
  artifactUri!: string;

  @Matches(/^[0-9a-f]{64}$/, {
    message: 'artifactSha256 must be 64 lowercase hex characters',
  })
  artifactSha256!: string;

  @IsString()
  @MaxLength(60)
  featureSchemaVersion!: string;

  @IsString()
  @MaxLength(60)
  labelSchemaVersion!: string;

  @Matches(/^[A-Za-z0-9._:-]{1,120}$/)
  datasetName!: string;

  @Matches(/^[A-Za-z0-9._:-]{1,120}$/)
  datasetVersion!: string;

  @Matches(/^sha256:[0-9a-f]{64}$/, {
    message: 'datasetFingerprint must be sha256:<hex>',
  })
  datasetFingerprint!: string;

  @IsBoolean()
  syntheticData!: boolean;

  @IsObject()
  trainingConfig!: Record<string, unknown>;

  @IsOptional()
  @Matches(/^[0-9a-f]{7,64}$/)
  codeRevision?: string | null;

  @IsDateString()
  trainedAt!: string;

  @IsObject()
  metrics!: Record<string, unknown>;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._:-]{1,120}$/)
  evaluationDatasetVersion?: string;
}

export class RecordEvaluationDto {
  @Matches(/^[A-Za-z0-9._:-]{1,120}$/)
  evaluationDatasetVersion!: string;

  /** Metrics from `python -m ml train` (its `metrics.test`) or `python -m ml evaluate`. */
  @IsObject()
  metrics!: Record<string, unknown>;
}

export class ApproveModelDto {
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  note!: string;
}

export class LifecycleReasonDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export class ListModelsQueryDto {
  @IsOptional()
  @IsIn(MODEL_TASKS)
  task?: ModelTask;
}

export class MonitoringQueryDto {
  @IsIn(MODEL_TASKS)
  task!: ModelTask;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days: number = 7;
}
