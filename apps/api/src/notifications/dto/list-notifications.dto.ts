import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  NOTIFICATION_FILTERS,
  NOTIFICATIONS_MAX_PAGE_SIZE,
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationFilter,
} from '@samadhaan/shared';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

/**
 * Listing the caller's notifications.
 *
 * There is no recipient parameter, and none can be added by a client: the
 * global `forbidNonWhitelisted` turns `?recipientId=…` into a 400 rather than
 * a field the handler might one day read.
 */
export class ListNotificationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(NOTIFICATION_FILTERS)
  filter: NotificationFilter = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATIONS_MAX_PAGE_SIZE)
  override limit: number = NOTIFICATIONS_PAGE_SIZE;
}

/**
 * The unread count takes no parameters at all. Declared anyway, so the global
 * whitelist rejects `?recipientId=…` here too rather than silently ignoring it
 * — a parameter that is ignored today is one a future change might read.
 */
export class UnreadCountQueryDto {}
