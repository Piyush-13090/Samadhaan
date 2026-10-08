import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AiModule } from './ai/ai.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommunityModule } from './community/community.module.js';
import { CoordinatorModule } from './coordinator/coordinator.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { createLoggerConfig } from './common/logger/logger.config.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { AppConfig } from './config/app.config.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/domain-event-bus.js';
import { MatchingModule } from './matching/matching.module.js';
import { GovernmentModule } from './government/government.module.js';
import { GeoModule } from './geo/geo.module.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { PriorityModule } from './priority/priority.module.js';
import { VerificationModule } from './verification/verification.module.js';
import { ImpactModule } from './impact/impact.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { HealthModule } from './health/health.module.js';
import { MediaModule } from './media/media.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { ProblemsModule } from './problems/problems.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ResolutionModule } from './resolution/resolution.module.js';
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
    // In-process domain events: publishers and consumers never import each other.
    EventsModule,

    // Platform boundary to the Python AI service
    AiModule,

    // Operations
    HealthModule,
    MediaModule,

    // Domain modules (boundaries established, implemented in later milestones)
    AuthModule,
    UsersModule,
    ResolutionModule,
    CoordinatorModule,
    KnowledgeModule,
    PriorityModule,
    VerificationModule,
    ImpactModule,
    AnalyticsModule,
    ProblemsModule,
    DashboardModule,
    OrganizationsModule,
    CommunityModule,
    SuggestionsModule,
    NotificationsModule,
    GeoModule,
    MatchingModule,
    GovernmentModule,
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
