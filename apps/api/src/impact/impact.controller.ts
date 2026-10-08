import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  API_VERSION,
  type BadgeView,
  type ContributionView,
  type ImpactSummary,
  type LeaderboardPage,
  type ReputationView,
} from '@samadhaan/shared';
import type { AuthenticatedRequest, RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { BadgeEvaluationService } from './badge-evaluation.service.js';
import {
  ImpactAdjustmentDto,
  ImpactHistoryQueryDto,
  LeaderboardQueryDto,
} from './impact.dto.js';
import { ImpactQueryService } from './impact-query.service.js';
import { ReputationService } from './reputation.service.js';

/**
 * The signed-in user's own impact (Prompt 23). Read-only: there is no endpoint
 * through which anyone creates, edits or deletes their own points or badges —
 * the ledger is written only by the server's award rules and audited admin
 * adjustments.
 */
@Controller({ path: 'users', version: API_VERSION.replace('v', '') })
export class ImpactController {
  constructor(
    private readonly queries: ImpactQueryService,
    private readonly reputation: ReputationService,
    private readonly badges: BadgeEvaluationService,
  ) {}

  @Get('me/impact')
  impact(
    @CurrentUser() user: RequestUser,
    @Query() query: ImpactHistoryQueryDto,
  ): Promise<ImpactSummary> {
    return this.queries.summary(user.id, query.filter, query.page, query.limit);
  }

  @Get('me/reputation')
  myReputation(@CurrentUser() user: RequestUser): Promise<ReputationView> {
    return this.reputation.view(user.id);
  }

  @Get('me/badges')
  myBadges(@CurrentUser() user: RequestUser): Promise<BadgeView[]> {
    return this.badges.view(user.id);
  }

  @Get('me/contributions')
  contributions(
    @CurrentUser() user: RequestUser,
    @Query() query: ImpactHistoryQueryDto,
  ): Promise<{
    items: ContributionView[];
    page: number;
    totalCount: number;
    totalPages: number;
  }> {
    return this.queries.contributions(user.id, query.page, query.limit);
  }
}

/** The public leaderboard: public names, avatars and scores only. */
@Controller({ path: 'leaderboard', version: API_VERSION.replace('v', '') })
export class LeaderboardController {
  constructor(private readonly queries: ImpactQueryService) {}

  @Public()
  @Get()
  @UserRateLimit({ bucket: 'leaderboard', max: 120, windowSeconds: 60 })
  leaderboard(
    @Query() query: LeaderboardQueryDto,
    @Req() request: Request,
  ): Promise<LeaderboardPage> {
    const viewer = (request as Request & AuthenticatedRequest).user ?? null;
    return this.queries.leaderboard(query, viewer);
  }
}

/** Audited corrections. Platform administrators only — not government officials. */
@Controller({ path: 'admin/users', version: API_VERSION.replace('v', '') })
@Roles('ADMIN')
export class AdminImpactController {
  constructor(private readonly queries: ImpactQueryService) {}

  @Post(':id/impact/adjust')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'impact-adjust', max: 30, windowSeconds: 600 })
  adjust(
    @CurrentUser() admin: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImpactAdjustmentDto,
  ): Promise<{ impactPoints: number }> {
    return this.queries.adjust(id, dto.amount, dto.reason, admin);
  }
}
