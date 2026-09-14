import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  PROBLEM_CATEGORIES,
  PROBLEM_STATUSES,
  type ProblemCategory,
  type ProblemStatus,
} from '@samadhaan/shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

/** How the citizen's own reports are ordered. */
export const MY_PROBLEM_SORTS = ['recent', 'oldest', 'severity', 'status'] as const;

export type MyProblemSort = (typeof MY_PROBLEM_SORTS)[number];

/**
 * Query for the citizen's own reports.
 *
 * Note what is *not* here: any way to name a user. The identity comes from the
 * verified token in the controller and nowhere else, so
 * `?userId=someone-else` is not a request this DTO can express — and the
 * global `forbidNonWhitelisted` rejects it outright rather than ignoring it.
 */
export class MyProblemsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PROBLEM_STATUSES)
  status?: ProblemStatus;

  @IsOptional()
  @IsIn(PROBLEM_CATEGORIES)
  category?: ProblemCategory;

  @IsOptional()
  @IsIn(MY_PROBLEM_SORTS)
  sort: MyProblemSort = 'recent';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  override limit: number = 20;
}
