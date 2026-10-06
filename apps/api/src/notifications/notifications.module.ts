import { Module } from '@nestjs/common';
import { NotificationEventHandler } from './notification-event.handler.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * In-app notifications and the activity center.
 *
 * Fed entirely by domain events on the global bus — no other module imports
 * this one or calls into it. See `NotificationEventHandler` for the flow and
 * `notification-channels.ts` for where email, push and realtime attach.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationEventHandler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
