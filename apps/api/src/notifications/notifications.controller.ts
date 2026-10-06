import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  API_VERSION,
  type MarkAllReadResult,
  type NotificationPage,
  type NotificationView,
  type UnreadCount,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import {
  ListNotificationsQueryDto,
  UnreadCountQueryDto,
} from './dto/list-notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

/**
 * The signed-in user's notifications.
 *
 * Every route requires a session (the global guard's default — none is
 * `@Public()`), and every route passes `user.id` as the recipient. No route
 * accepts a recipient in its path, query or body: the only person whose
 * notifications these endpoints can reach is the caller.
 */
@Controller({ path: 'notifications', version: API_VERSION.replace('v', '') })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Query() query: ListNotificationsQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<NotificationPage> {
    return this.notifications.list(user.id, query);
  }

  /** The bell's badge. One indexed count; cheap enough to poll. */
  @Get('unread-count')
  async unreadCount(
    @Query() _query: UnreadCountQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<UnreadCount> {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  /** Declared before `:id/read` for readability; the paths cannot collide. */
  @Patch('read-all')
  markAllRead(@CurrentUser() user: RequestUser): Promise<MarkAllReadResult> {
    return this.notifications.markAllRead(user.id);
  }

  @Patch(':id/read')
  markRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<NotificationView> {
    return this.notifications.markRead(user.id, id);
  }

  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ unreadCount: number }> {
    return this.notifications.remove(user.id, id);
  }
}
