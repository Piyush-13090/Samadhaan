import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { COMMENT_BODY_MAX_LENGTH, COMMENTS_PAGE_SIZE } from '@samadhaan/shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

/**
 * Raw-length ceiling, applied before normalisation.
 *
 * The precise rule — 2 to 2000 characters *after* trimming and collapsing
 * whitespace — is enforced by `checkCommentContent`, because only after
 * normalisation is the length meaningful. This cap exists so a megabyte of
 * spaces is refused at the door rather than normalised first.
 */
const RAW_BODY_CEILING = COMMENT_BODY_MAX_LENGTH * 2;

/**
 * A new comment or reply.
 *
 * Note what is absent, and why the global `forbidNonWhitelisted` matters here:
 * no `userId`, no `problemId` (it comes from the path), no `createdAt`, no
 * `isEdited`. A request that invents any of them is a 400, not a field quietly
 * written into the row.
 */
export class CreateCommentDto {
  @IsString({ message: 'Write a comment.' })
  @MaxLength(RAW_BODY_CEILING, {
    message: `Keep comments under ${COMMENT_BODY_MAX_LENGTH} characters.`,
  })
  body!: string;

  /** Set to reply. Must be a top-level comment on the same problem. */
  @IsOptional()
  @IsUUID('all', { message: 'parentCommentId must be a valid comment id' })
  parentCommentId?: string;
}

/** An edit. Only the body can change — a comment cannot be moved between threads. */
export class UpdateCommentDto {
  @IsString({ message: 'Write a comment.' })
  @MaxLength(RAW_BODY_CEILING, {
    message: `Keep comments under ${COMMENT_BODY_MAX_LENGTH} characters.`,
  })
  body!: string;
}

/**
 * Listing comments.
 *
 * Without `parentCommentId`: top-level comments, newest first, each with a
 * preview of its replies. With it: that comment's replies, oldest first, so a
 * thread reads as a conversation.
 */
export class ListCommentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'parentCommentId must be a valid comment id' })
  parentCommentId?: string;

  /** Bounded tighter than the shared default: a thread is read, not exported. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  override limit: number = COMMENTS_PAGE_SIZE;
}
