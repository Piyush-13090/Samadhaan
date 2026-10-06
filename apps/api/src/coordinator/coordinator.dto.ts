import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  PROJECT_UPDATE_ITEMS_MAX,
  PROJECT_UPDATE_ITEM_MAX,
  QUESTION_ANSWER_MAX,
  UPDATE_EXTRACT_TEXT_MAX,
} from '@samadhaan/shared';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimItems = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : item))
        .filter((item) => item !== '')
    : value;

/** Quick replies, so answering is one tap; free text may accompany them. */
export const QUICK_ANSWERS = ['COMPLETED', 'NOT_YET'] as const;

export class AnswerQuestionDto {
  @IsOptional()
  @IsIn(QUICK_ANSWERS)
  quick?: (typeof QUICK_ANSWERS)[number];

  @ValidateIf((dto: AnswerQuestionDto) => !dto.quick || dto.answer !== undefined)
  @IsDefined({ message: 'Write an answer, or choose a quick reply.' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Write an answer, or choose a quick reply.' })
  @MaxLength(QUESTION_ANSWER_MAX)
  answer?: string;
}

export class ExtractUpdateDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(UPDATE_EXTRACT_TEXT_MAX)
  text?: string;

  /** Draft from the caller's team's room messages since the last update. */
  @IsOptional()
  @IsBoolean()
  fromRecentMessages?: boolean;
}

export class PostUpdateDto {
  @IsDefined({ message: 'Summarise the update.' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Summarise the update.' })
  @MaxLength(400)
  summary!: string;

  @IsOptional()
  @Transform(trimItems)
  @IsArray()
  @ArrayMaxSize(PROJECT_UPDATE_ITEMS_MAX)
  @IsString({ each: true })
  @MaxLength(PROJECT_UPDATE_ITEM_MAX, { each: true })
  completed?: string[];

  @IsOptional()
  @Transform(trimItems)
  @IsArray()
  @ArrayMaxSize(PROJECT_UPDATE_ITEMS_MAX)
  @IsString({ each: true })
  @MaxLength(PROJECT_UPDATE_ITEM_MAX, { each: true })
  current?: string[];

  @IsOptional()
  @Transform(trimItems)
  @IsArray()
  @ArrayMaxSize(PROJECT_UPDATE_ITEMS_MAX)
  @IsString({ each: true })
  @MaxLength(PROJECT_UPDATE_ITEM_MAX, { each: true })
  blockers?: string[];

  @IsOptional()
  @Transform(trimItems)
  @IsArray()
  @ArrayMaxSize(PROJECT_UPDATE_ITEMS_MAX)
  @IsString({ each: true })
  @MaxLength(PROJECT_UPDATE_ITEM_MAX, { each: true })
  nextSteps?: string[];

  /** AI_ASSISTED when the author confirmed a coordinator draft. */
  @IsOptional()
  @IsIn(['MANUAL', 'AI_ASSISTED'])
  source?: 'MANUAL' | 'AI_ASSISTED';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  aiModel?: string;
}

export class UpdatesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}
