import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  API_VERSION,
  type GovernmentPriorityView,
  type PublicPriorityView,
} from '@samadhaan/shared';
import type { AuthenticatedRequest, RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import type { GovernmentScope } from '../government/government-access.service.js';
import { CurrentGovernment, GovernmentGuard } from '../government/government.guard.js';
import {
  PriorityOverrideDto,
  RecalculateDto,
  RemoveOverrideDto,
} from './priority.dto.js';
import { PriorityService } from './priority.service.js';

/**
 * Government priority endpoints (Prompt 21), inside the portal's existing
 * authorisation: role GOVERNMENT (ADMIN deliberately not listed), active
 * membership of an operational office (`GovernmentGuard`), and the problem in
 * that office's jurisdiction — 404 otherwise.
 */
@Controller({ path: 'government', version: API_VERSION.replace('v', '') })
@Roles('GOVERNMENT')
@UseGuards(GovernmentGuard)
export class GovernmentPriorityController {
  constructor(private readonly priority: PriorityService) {}

  @Get(':slug/problems/:publicId/priority')
  view(
    @CurrentGovernment() scope: GovernmentScope,
    @Param('publicId') publicId: string,
  ): Promise<GovernmentPriorityView> {
    return this.priority.governmentView(scope, publicId);
  }

  @Post(':slug/problems/:publicId/priority/recalculate')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'priority-recalculate', max: 10, windowSeconds: 600 })
  recalculate(
    @CurrentGovernment() scope: GovernmentScope,
    @Param('publicId') publicId: string,
    @Body() dto: RecalculateDto,
  ): Promise<GovernmentPriorityView> {
    return this.priority.recalculate(scope, publicId, dto.refreshAi ?? false);
  }

  @Post(':slug/problems/:publicId/priority/override')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'priority-override', max: 30, windowSeconds: 600 })
  override(
    @CurrentGovernment() scope: GovernmentScope,
    @CurrentUser() user: RequestUser,
    @Param('publicId') publicId: string,
    @Body() dto: PriorityOverrideDto,
  ): Promise<GovernmentPriorityView> {
    return this.priority.setOverride(scope, publicId, dto, user);
  }

  @Delete(':slug/problems/:publicId/priority/override')
  @UserRateLimit({ bucket: 'priority-override', max: 30, windowSeconds: 600 })
  removeOverride(
    @CurrentGovernment() scope: GovernmentScope,
    @CurrentUser() user: RequestUser,
    @Param('publicId') publicId: string,
    @Body() dto: RemoveOverrideDto,
  ): Promise<GovernmentPriorityView> {
    return this.priority.removeOverride(scope, publicId, dto.reason || null, user);
  }
}

/** The public, simplified level — like the problem itself, readable by anyone who can see it. */
@Controller({ path: 'problems', version: API_VERSION.replace('v', '') })
export class PublicPriorityController {
  constructor(private readonly priority: PriorityService) {}

  @Public()
  @Get(':publicId/priority')
  view(
    @Param('publicId') publicId: string,
    @Req() request: Request,
  ): Promise<PublicPriorityView> {
    const viewer = (request as Request & AuthenticatedRequest).user ?? null;
    return this.priority.publicView(publicId, viewer);
  }
}
