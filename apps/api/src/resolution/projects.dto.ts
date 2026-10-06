import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_STATUSES,
  TASKS_PAGE_MAX,
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TITLE_MAX_LENGTH,
  type ProjectStatus,
  type TaskPriority,
  type TaskStatus,
} from '@samadhaan/shared';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** Empty strings clear an optional text field. */
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const list = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').filter(Boolean) : value;

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATE_MESSAGE = 'Use a date in the form YYYY-MM-DD.';

/**
 * None of these DTOs has a project, organisation, creator or room field: all
 * come from the URL and the proven context. Unknown fields are rejected by the
 * global validation pipe.
 */
export class UpdateProjectDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PROJECT_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PROJECT_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE, { message: DATE_MESSAGE })
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE, { message: DATE_MESSAGE })
  targetDate?: string | null;
}

export class ProjectStatusDto {
  @IsIn(PROJECT_STATUSES)
  status!: ProjectStatus;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  reason?: string | null;
}

export class CreateTaskDto {
  @IsDefined({ message: 'Give the task a title.' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Give the task a title.' })
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title!: string;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(TASK_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assignedToId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE, { message: DATE_MESSAGE })
  dueDate?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  milestoneId?: string | null;
}

/**
 * Not `extends CreateTaskDto`: class-validator merges inherited decorators, so
 * the title would stay required. Every field here is optional but `version`.
 */
export class UpdateTaskDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Give the task a title.' })
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(TASK_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assignedToId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE, { message: DATE_MESSAGE })
  dueDate?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  milestoneId?: string | null;
}

export class TaskStatusDto {
  @IsIn(TASK_STATUSES)
  status!: TaskStatus;
}

export class TaskAttachmentDto {
  @IsUUID()
  attachmentId!: string;
}

export class TasksQueryDto {
  @IsOptional()
  @Transform(list)
  @IsIn(TASK_STATUSES, { each: true })
  status?: TaskStatus[];

  @IsOptional()
  @Transform(list)
  @IsIn(TASK_PRIORITIES, { each: true })
  priority?: TaskPriority[];

  /** A member's id, `me`, or `unassigned`. */
  @IsOptional()
  @ValidateIf((_, value) => value !== 'me' && value !== 'unassigned')
  @IsUUID()
  assignee?: string;

  @IsOptional()
  @IsUUID()
  milestoneId?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;

  @IsOptional()
  @Matches(DATE, { message: DATE_MESSAGE })
  dueBefore?: string;

  @IsOptional()
  @Matches(DATE, { message: DATE_MESSAGE })
  dueAfter?: string;

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
  @Max(TASKS_PAGE_MAX)
  limit: number = 100;
}

export class CreateMilestoneDto {
  @IsDefined({ message: 'Give the milestone a title.' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Give the milestone a title.' })
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title!: string;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(TASK_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE, { message: DATE_MESSAGE })
  dueDate?: string | null;
}

export class UpdateMilestoneDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Give the milestone a title.' })
  @MaxLength(TASK_TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(TASK_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE, { message: DATE_MESSAGE })
  dueDate?: string | null;
}

export class ActivityQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}
