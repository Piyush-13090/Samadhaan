import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  API_VERSION,
  type AnalyticsAreas,
  type AnalyticsCategories,
  type AnalyticsCommunity,
  type AnalyticsHotspots,
  type AnalyticsInsightView,
  type AnalyticsOverview,
  type AnalyticsRecurring,
  type AnalyticsResolution,
  type AnalyticsTrends,
  type CitizenAnalytics,
  type OrganizationAnalytics,
} from '@samadhaan/shared';
import type { Request } from 'express';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { getRequestId } from '../common/request-context.js';
import type { GovernmentScope } from '../government/government-access.service.js';
import { CurrentGovernment, GovernmentGuard } from '../government/government.guard.js';
import type { WorkspaceContext } from '../organizations/organization-access.service.js';
import {
  CurrentWorkspace,
  OrganizationWorkspaceGuard,
} from '../organizations/workspace/organization-workspace.guard.js';
import { AnalyticsExportService } from './analytics-export.service.js';
import { AnalyticsInsightsService } from './analytics-insights.service.js';
import {
  AnalyticsExportDto,
  AnalyticsPeriodDto,
  AnalyticsQueryDto,
} from './analytics.dto.js';
import { GovernmentAnalyticsService } from './government-analytics.service.js';
import { OrganizationAnalyticsService } from './organization-analytics.service.js';

const version = API_VERSION.replace('v', '');

/**
 * The command centre's analytics (Prompt 24). Government officials only, for
 * their own office: `GovernmentGuard` proves active membership and supplies
 * the jurisdiction predicate every query includes.
 */
@Controller({ path: 'government', version })
@Roles('GOVERNMENT')
@UseGuards(GovernmentGuard)
export class GovernmentAnalyticsController {
  constructor(
    private readonly analytics: GovernmentAnalyticsService,
    private readonly insights: AnalyticsInsightsService,
    private readonly exports: AnalyticsExportService,
  ) {}

  @Get(':slug/analytics/overview')
  overview(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: AnalyticsQueryDto,
  ): Promise<AnalyticsOverview> {
    return this.analytics.overview(this.analytics.context(scope, query));
  }

  @Get(':slug/analytics/trends')
  trends(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: AnalyticsQueryDto,
  ): Promise<AnalyticsTrends> {
    return this.analytics.trends(this.analytics.context(scope, query));
  }

  @Get(':slug/analytics/categories')
  categories(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: AnalyticsQueryDto,
  ): Promise<AnalyticsCategories> {
    return this.analytics.categories(this.analytics.context(scope, query));
  }

  @Get(':slug/analytics/areas')
  areas(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: AnalyticsQueryDto,
  ): Promise<AnalyticsAreas> {
    return this.analytics.areas(this.analytics.context(scope, query));
  }

  @Get(':slug/analytics/resolution')
  resolution(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: AnalyticsQueryDto,
  ): Promise<AnalyticsResolution> {
    return this.analytics.resolution(this.analytics.context(scope, query));
  }

  @Get(':slug/analytics/community')
  community(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: AnalyticsQueryDto,
  ): Promise<AnalyticsCommunity> {
    return this.analytics.community(this.analytics.context(scope, query));
  }

  @Get(':slug/analytics/hotspots')
  hotspots(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: AnalyticsQueryDto,
  ): Promise<AnalyticsHotspots> {
    return this.analytics.hotspots(this.analytics.context(scope, query));
  }

  @Get(':slug/analytics/recurring')
  recurring(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: AnalyticsQueryDto,
  ): Promise<AnalyticsRecurring> {
    return this.analytics.recurring(this.analytics.context(scope, query));
  }

  /** The last summary generated for exactly this period and filters, if any. */
  @Get(':slug/analytics/insights')
  async latestInsight(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: AnalyticsQueryDto,
  ): Promise<{ insight: AnalyticsInsightView | null }> {
    return { insight: await this.insights.latest(this.analytics.context(scope, query)) };
  }

  /** Generates a summary on request. It suggests and decides nothing. */
  @Post(':slug/analytics/insights')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'analytics-insight', max: 10, windowSeconds: 3600 })
  async generateInsight(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: AnalyticsQueryDto,
    @Req() request: Request,
  ): Promise<{ insight: AnalyticsInsightView }> {
    return {
      insight: await this.insights.generate(
        this.analytics.context(scope, query),
        getRequestId(request),
      ),
    };
  }

  @Get(':slug/analytics/export')
  @UserRateLimit({ bucket: 'analytics-export', max: 30, windowSeconds: 3600 })
  async export(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: AnalyticsExportDto,
    @CurrentUser() user: RequestUser,
  ): Promise<StreamableFile> {
    const file = await this.exports.export(
      this.analytics.context(scope, query),
      query.dataset,
      query.format,
      user.id,
    );
    return new StreamableFile(Buffer.from(file.body, 'utf8'), {
      type: file.contentType,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }
}

/** An organisation's own delivery analytics — members only, no ranking. */
@Controller({ path: 'organizations', version })
export class OrganizationAnalyticsController {
  constructor(private readonly analytics: OrganizationAnalyticsService) {}

  @Get(':slug/analytics')
  @UseGuards(OrganizationWorkspaceGuard)
  summary(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Query() query: AnalyticsPeriodDto,
  ): Promise<OrganizationAnalytics> {
    return this.analytics.summary(workspace, query);
  }
}

/** A citizen's own figures. The user comes from the session, never the URL. */
@Controller({ path: 'users', version })
export class CitizenAnalyticsController {
  constructor(private readonly analytics: OrganizationAnalyticsService) {}

  @Get('me/analytics')
  mine(@CurrentUser() user: RequestUser): Promise<CitizenAnalytics> {
    return this.analytics.citizen(user.id);
  }
}
