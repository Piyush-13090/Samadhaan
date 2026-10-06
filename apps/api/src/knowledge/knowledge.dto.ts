import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  KNOWLEDGE_CONTEXTS,
  KNOWLEDGE_DESCRIPTION_MAX,
  KNOWLEDGE_INLINE_TEXT_MAX,
  KNOWLEDGE_QUESTION_MAX,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_TITLE_MAX,
  KNOWLEDGE_VISIBILITIES,
  PROBLEM_CATEGORIES,
  type KnowledgeContext,
  type KnowledgeSourceType,
  type KnowledgeVisibility,
  type ProblemCategory,
} from '@samadhaan/shared';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

/**
 * No uploader, status, chunk or embedding fields: those come from the session
 * and the pipeline. Unknown fields are rejected by the global pipe.
 */
export class CreateKnowledgeSourceDto {
  @IsDefined()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(KNOWLEDGE_TITLE_MAX)
  title!: string;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(KNOWLEDGE_DESCRIPTION_MAX)
  description?: string | null;

  @IsIn(KNOWLEDGE_SOURCE_TYPES)
  sourceType!: KnowledgeSourceType;

  @IsIn(KNOWLEDGE_VISIBILITIES)
  visibility!: KnowledgeVisibility;

  /** The office or organisation that owns it — checked against membership. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  organizationId?: string | null;

  /** PROJECT visibility — checked against project access. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  projectId?: string | null;

  /** A reference link. Never fetched by the server. */
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(2000)
  externalUrl?: string | null;

  /** Pasted text (Markdown or plain). Or upload a file afterwards. */
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(KNOWLEDGE_INLINE_TEXT_MAX)
  content?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROBLEM_CATEGORIES.length)
  @IsIn(PROBLEM_CATEGORIES, { each: true })
  categories?: ProblemCategory[];

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  city?: string | null;
}

export class UpdateKnowledgeSourceDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(KNOWLEDGE_TITLE_MAX)
  title?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(KNOWLEDGE_DESCRIPTION_MAX)
  description?: string | null;

  @IsOptional()
  @IsIn(KNOWLEDGE_SOURCE_TYPES)
  sourceType?: KnowledgeSourceType;

  @IsOptional()
  @IsArray()
  @IsIn(PROBLEM_CATEGORIES, { each: true })
  categories?: ProblemCategory[];

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  externalUrl?: string | null;

  /** Replacing the text re-indexes the source. */
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(KNOWLEDGE_INLINE_TEXT_MAX)
  content?: string | null;
}

export class ListKnowledgeSourcesDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  manageable?: boolean;

  @IsOptional()
  @IsIn(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
  status?: string;

  @IsOptional()
  @IsIn(KNOWLEDGE_SOURCE_TYPES)
  sourceType?: KnowledgeSourceType;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

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
  @Max(100)
  limit: number = 20;
}

export class KnowledgeQueryDto {
  @IsDefined({ message: 'Ask a question.' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Ask a question.' })
  @MaxLength(KNOWLEDGE_QUESTION_MAX)
  query!: string;

  @IsOptional()
  @IsIn(KNOWLEDGE_CONTEXTS)
  contextType?: KnowledgeContext;

  /** A problem's public reference, e.g. SAM-1023. */
  @IsOptional()
  @Matches(/^SAM-\d{1,10}$/i)
  problemId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  topK?: number;

  /** `retrieve` returns passages only, without generating an answer. */
  @IsOptional()
  @IsIn(['answer', 'retrieve'])
  mode?: 'answer' | 'retrieve';
}
