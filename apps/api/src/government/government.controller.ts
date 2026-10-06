import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  API_VERSION,
  type AllocationCandidate,
  type GovernmentActivityEntry,
  type GovernmentAllocationPanel,
  type GovernmentAllocationView,
  type GovernmentContext,
  type GovernmentDashboard,
  type GovernmentInternalNote,
  type GovernmentProblemDetail,
  type GovernmentProblemPage,
  type GovernmentWorkspaceSummary,
  type MapAggregateCollection,
  type MapProblemCollection,
  type ProblemStatus,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { AppException } from '../common/app.exception.js';
import type { GovernmentScope } from './government-access.service.js';
import { GovernmentAccessService } from './government-access.service.js';
import {
  DashboardQueryDto,
  GovernmentMapQueryDto,
  GovernmentProblemsQueryDto,
  CancelAllocationDto,
  CandidateSearchDto,
  CreateAllocationDto,
  InternalNoteDto,
  StatusTransitionDto,
} from './government.dto.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { CurrentGovernment, GovernmentGuard } from './government.guard.js';
import { GovernmentMapService } from './government-map.service.js';
import { GovernmentProblemsService } from './government-problems.service.js';
import { GovernmentService } from './government.service.js';

/**
 * The government portal.
 *
 * `@Roles('GOVERNMENT')` on the class: platform ADMIN is deliberately not
 * listed — an administrator is not an official of any jurisdiction. Every
 * `:slug` route then passes `GovernmentGuard` (active membership of an
 * operational GOVERNMENT organisation), and every query inside applies that
 * office's jurisdiction predicate.
 */
@Controller({ path: 'government', version: API_VERSION.replace('v', '') })
@Roles('GOVERNMENT')
export class GovernmentController {
  constructor(
    private readonly access: GovernmentAccessService,
    private readonly government: GovernmentService,
    private readonly problems: GovernmentProblemsService,
    private readonly maps: GovernmentMapService,
    private readonly allocations: AllocationsService,
  ) {}

  /** The offices the caller works for. */
  @Get('mine')
  mine(@CurrentUser() user: RequestUser): Promise<GovernmentWorkspaceSummary[]> {
    return this.access.mine(user);
  }

  @Get(':slug/context')
  @UseGuards(GovernmentGuard)
  context(
    @CurrentGovernment() scope: GovernmentScope,
    @CurrentUser() user: RequestUser,
  ): Promise<GovernmentContext> {
    return this.government.context(scope, user.id);
  }

  @Get(':slug/dashboard')
  @UseGuards(GovernmentGuard)
  dashboard(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: DashboardQueryDto,
  ): Promise<GovernmentDashboard> {
    return this.government.dashboard(scope, query.range);
  }

  @Get(':slug/activity')
  @UseGuards(GovernmentGuard)
  async activity(
    @CurrentGovernment() scope: GovernmentScope,
  ): Promise<GovernmentActivityEntry[]> {
    const entries = await this.problems.audit(scope, { limit: 30 });
    return entries.map(({ note: _note, ...entry }) => entry);
  }

  @Get(':slug/problems')
  @UseGuards(GovernmentGuard)
  list(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: GovernmentProblemsQueryDto,
  ): Promise<GovernmentProblemPage> {
    const { page, limit, reportedFrom, reportedTo, ...filters } = query;
    const from = reportedFrom ? new Date(reportedFrom) : undefined;
    // An inclusive end date: everything before the following midnight.
    const to = reportedTo
      ? new Date(new Date(reportedTo).getTime() + 86_400_000)
      : undefined;
    if (from && to && from >= to) {
      throw AppException.badRequest('reportedFrom must be before reportedTo');
    }
    return this.problems.list(
      scope,
      { ...filters, reportedFrom: from, reportedTo: to },
      page,
      limit,
    );
  }

  @Get(':slug/problems/:publicId')
  @UseGuards(GovernmentGuard)
  detail(
    @CurrentGovernment() scope: GovernmentScope,
    @Param('publicId') publicId: string,
  ): Promise<GovernmentProblemDetail> {
    return this.problems.detail(scope, publicId);
  }

  /** Review decisions: SUBMITTED → UNDER_REVIEW, UNDER_REVIEW → VERIFIED / REJECTED. */
  @Patch(':slug/problems/:publicId/status')
  @UseGuards(GovernmentGuard)
  @UserRateLimit({ bucket: 'gov-review', max: 120, windowSeconds: 60 })
  transition(
    @CurrentGovernment() scope: GovernmentScope,
    @CurrentUser() user: RequestUser,
    @Param('publicId') publicId: string,
    @Body() dto: StatusTransitionDto,
  ): Promise<{ status: ProblemStatus; allowedTransitions: ProblemStatus[] }> {
    return this.problems.transition(scope, publicId, dto.status, dto.note ?? null, user);
  }

  @Post(':slug/problems/:publicId/notes')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(GovernmentGuard)
  @UserRateLimit({ bucket: 'gov-note', max: 60, windowSeconds: 60 })
  addNote(
    @CurrentGovernment() scope: GovernmentScope,
    @CurrentUser() user: RequestUser,
    @Param('publicId') publicId: string,
    @Body() dto: InternalNoteDto,
  ): Promise<GovernmentInternalNote> {
    return this.problems.addNote(scope, publicId, dto.body, user);
  }

  @Get(':slug/problems/:publicId/audit')
  @UseGuards(GovernmentGuard)
  async audit(
    @CurrentGovernment() scope: GovernmentScope,
    @Param('publicId') publicId: string,
  ) {
    const { id } = await this.problems.findInScope(scope, publicId);
    return this.problems.audit(scope, { problemId: id, limit: 100 });
  }

  /** Problems in a viewport — inside the jurisdiction only. */
  @Get(':slug/map')
  @UseGuards(GovernmentGuard)
  map(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: GovernmentMapQueryDto,
  ): Promise<MapProblemCollection> {
    return this.maps.problems(scope, query);
  }

  @Get(':slug/map/aggregate')
  @UseGuards(GovernmentGuard)
  aggregate(
    @CurrentGovernment() scope: GovernmentScope,
    @Query() query: GovernmentMapQueryDto,
  ): Promise<MapAggregateCollection> {
    return this.maps.aggregate(scope, query);
  }

  // ---------------------------------------------------------- allocation

  /** Allocation state, history and matched candidates for one problem. */
  @Get(':slug/problems/:publicId/allocations')
  @UseGuards(GovernmentGuard)
  async allocationPanel(
    @CurrentGovernment() scope: GovernmentScope,
    @Param('publicId') publicId: string,
  ): Promise<GovernmentAllocationPanel> {
    const problem = await this.problems.findInScope(scope, publicId);
    return this.allocations.governmentPanel(scope, problem);
  }

  /** Any eligible organisation by name — not only the engine's suggestions. */
  @Get(':slug/problems/:publicId/allocation-candidates')
  @UseGuards(GovernmentGuard)
  async allocationCandidates(
    @CurrentGovernment() scope: GovernmentScope,
    @Param('publicId') publicId: string,
    @Query() query: CandidateSearchDto,
  ): Promise<AllocationCandidate[]> {
    const problem = await this.problems.findInScope(scope, publicId);
    return this.allocations.searchCandidates(problem.id, query.q);
  }

  /** Sends an official allocation request. Never automatic. */
  @Post(':slug/problems/:publicId/allocations')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(GovernmentGuard)
  @UserRateLimit({ bucket: 'gov-allocate', max: 60, windowSeconds: 60 })
  allocate(
    @CurrentGovernment() scope: GovernmentScope,
    @CurrentUser() user: RequestUser,
    @Param('publicId') publicId: string,
    @Body() dto: CreateAllocationDto,
  ): Promise<GovernmentAllocationView> {
    return this.allocations.create(
      scope,
      publicId,
      {
        organizationId: dto.organizationId,
        instructions: dto.instructions ?? null,
        internalReason: dto.internalReason ?? null,
      },
      user,
    );
  }

  /** Withdraws a pending allocation this office made. */
  @Post(':slug/allocations/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(GovernmentGuard)
  cancelAllocation(
    @CurrentGovernment() scope: GovernmentScope,
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAllocationDto,
  ): Promise<GovernmentAllocationView> {
    return this.allocations.cancel(scope, id, dto.reason ?? null, user);
  }
}
