import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { GovernmentModule } from '../government/government.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { AnalyticsCacheService } from './analytics-cache.service.js';
import { AnalyticsExportService } from './analytics-export.service.js';
import { AnalyticsInsightsService } from './analytics-insights.service.js';
import {
  CitizenAnalyticsController,
  GovernmentAnalyticsController,
  OrganizationAnalyticsController,
} from './analytics.controller.js';
import { GovernmentAnalyticsService } from './government-analytics.service.js';
import { OrganizationAnalyticsService } from './organization-analytics.service.js';

/**
 * Civic analytics (Prompt 24): operational data → indexed SQL aggregates →
 * permission-scoped APIs → dashboards. See docs/ANALYTICS_ARCHITECTURE.md.
 */
@Module({
  imports: [AiModule, GovernmentModule, KnowledgeModule, OrganizationsModule],
  controllers: [
    GovernmentAnalyticsController,
    OrganizationAnalyticsController,
    CitizenAnalyticsController,
  ],
  providers: [
    AnalyticsCacheService,
    GovernmentAnalyticsService,
    OrganizationAnalyticsService,
    AnalyticsInsightsService,
    AnalyticsExportService,
  ],
})
export class AnalyticsModule {}
