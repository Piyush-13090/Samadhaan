import { Module } from '@nestjs/common';

/**
 * Notification delivery: in-app feed, email and push, fanned out over Redis-backed queues.
 *
 * Boundary only in this milestone: the module is registered and wired into
 * `AppModule` so later prompts add controllers, services and DTOs here
 * without restructuring the application.
 */
@Module({})
export class NotificationsModule {}
