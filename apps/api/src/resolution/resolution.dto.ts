import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
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
  RESOLUTION_CLOSE_REASON_MAX_LENGTH,
  RESOLUTION_MAX_ATTACHMENTS_PER_MESSAGE,
  RESOLUTION_MAX_MENTIONS,
  RESOLUTION_MESSAGES_PAGE_DEFAULT,
  RESOLUTION_MESSAGES_PAGE_MAX,
  RESOLUTION_MESSAGE_MAX_LENGTH,
} from '@samadhaan/shared';

/** Trims the ends only — line breaks inside a message are meaningful. */
const trimEnds = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A message. No author, room or organisation field exists here: all three
 * come from the session and the proven room context, and the global
 * validation pipe rejects unknown fields outright.
 */
export class PostMessageDto {
  @IsDefined({ message: 'Write a message first.' })
  @Transform(trimEnds)
  @IsString()
  @MinLength(1, { message: 'Write a message first.' })
  @MaxLength(RESOLUTION_MESSAGE_MAX_LENGTH)
  body!: string;

  /** Participants named in the message. Non-participants are dropped. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(RESOLUTION_MAX_MENTIONS)
  @IsUUID('all', { each: true })
  mentionUserIds?: string[];

  /** The sender's own uploads to this room, not yet attached. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(RESOLUTION_MAX_ATTACHMENTS_PER_MESSAGE)
  @IsUUID('all', { each: true })
  attachmentIds?: string[];
}

export class EditMessageDto {
  @IsDefined({ message: 'Write a message first.' })
  @Transform(trimEnds)
  @IsString()
  @MinLength(1, { message: 'Write a message first.' })
  @MaxLength(RESOLUTION_MESSAGE_MAX_LENGTH)
  body!: string;
}

export class MessagesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RESOLUTION_MESSAGES_PAGE_MAX)
  limit: number = RESOLUTION_MESSAGES_PAGE_DEFAULT;
}

export class CloseRoomDto {
  @IsDefined({ message: 'Give a reason for closing the room.' })
  @Transform(trimEnds)
  @IsString()
  @MinLength(3, { message: 'Give a reason for closing the room.' })
  @MaxLength(RESOLUTION_CLOSE_REASON_MAX_LENGTH)
  reason!: string;
}
