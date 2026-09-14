import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AiModule } from './ai/ai.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommentsModule } from './comments/comments.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { createLoggerConfig } from './common/logger/logger.config.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { AppConfig } from './config/app.config.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { MediaModule } from './media/media.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { ProblemsModule } from './problems/problems.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';
import { SuggestionsModule } from './suggestions/suggestions.module.js';
import { UsersModule } from './users/users.module.js';

/**
 * Composition root of the modular monolith.
 *
 * Infrastructure modules (config, logging, database, Redis) are global; feature
 * modules own their own slice of the domain and communicate through injected
 * services rather than shared state, which keeps the option of extracting one
 * into its own deployable open without rewriting callers.
 */
@Module({
  imports: [
    // Infrastructure
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: createLoggerConfig,
    }),
    DatabaseModule,
    RedisModule,
    StorageModule,

    // Platform boundary to the Python AI service
    AiModule,

    // Operations
    HealthModule,
    MediaModule,

    // Domain modules (boundaries established, implemented in later milestones)
    AuthModule,
    UsersModule,
    ProblemsModule,
    DashboardModule,
    OrganizationsModule,
    CommentsModule,
    SuggestionsModule,
    NotificationsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // '{*path}' is the path-to-regexp v8 wildcard used by Express 5.
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
