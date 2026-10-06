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
  UseGuards,
} from '@nestjs/common';
import {
  API_VERSION,
  type MyOrganizations,
  type OrganizationDashboard,
  type OrganizationProblemPage,
  type OrganizationAllocationDetail,
  type OrganizationAllocationPage,
  type OrganizationWorkspace,
  type RecommendationPage,
} from '@samadhaan/shared';
import { AllocationsService } from '../../allocations/allocations.service.js';
import type { RequestUser } from '../../auth/auth.types.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import type { WorkspaceContext } from '../organization-access.service.js';
import { OrganizationsService } from '../organizations.service.js';
import { OrganizationProblemsService } from './organization-problems.service.js';
import {
  CurrentWorkspace,
  OrganizationWorkspaceGuard,
  WorkspaceRoles,
} from './organization-workspace.guard.js';
import { OrganizationWorkspaceService } from './organization-workspace.service.js';
import {
  AcceptAllocationDto,
  AllocationListQueryDto,
  DeclineAllocationDto,
  RecommendationsQueryDto,
  WorkspaceProblemsQueryDto,
} from './workspace-problems.dto.js';

/**
 * The organisation workspace.
 *
 * Every route needs a session (no `@Public()`), and every `:slug` route also
 * passes `OrganizationWorkspaceGuard`, which proves an active membership of an
 * operational NGO, university or industry organisation before the handler
 * runs. Nothing here accepts an organisation id or a user id from the client.
 *
 * Registered before `OrganizationsController` so the literal `mine` and
 * `invitations` segments are matched before the public `:slug` profile route.
 */
@Controller({ path: 'organizations', version: API_VERSION.replace('v', '') })
export class OrganizationWorkspaceController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly workspaces: OrganizationWorkspaceService,
    private readonly problems: OrganizationProblemsService,
    private readonly allocations: AllocationsService,
  ) {}

  /** The caller's workspaces and pending invitations — the switcher's data. */
  @Get('mine')
  mine(@CurrentUser() user: RequestUser): Promise<MyOrganizations> {
    return this.organizations.mine(user);
  }

  @Post('invitations/:membershipId/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  accept(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.organizations.respondToInvitation(membershipId, true, user);
  }

  @Post('invitations/:membershipId/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.organizations.respondToInvitation(membershipId, false, user);
  }

  /** Organisation, membership and permissions. Also serves the settings page. */
  @Get(':slug/workspace')
  @UseGuards(OrganizationWorkspaceGuard)
  workspace(
    @CurrentWorkspace() workspace: WorkspaceContext,
  ): Promise<OrganizationWorkspace> {
    return this.workspaces.workspace(workspace);
  }

  @Get(':slug/dashboard')
  @UseGuards(OrganizationWorkspaceGuard)
  dashboard(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: RequestUser,
  ): Promise<OrganizationDashboard> {
    return this.workspaces.dashboard(workspace, user.id);
  }

  /** Server-side filtered, ordered and paginated. */
  @Get(':slug/problems')
  @UseGuards(OrganizationWorkspaceGuard)
  listProblems(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: RequestUser,
    @Query() query: WorkspaceProblemsQueryDto,
  ): Promise<OrganizationProblemPage> {
    const { page, limit, ...filters } = query;
    return this.problems.list(workspace.organization, user.id, filters, page, limit);
  }

  /**
   * Problems the AI matching engine found potentially relevant to this
   * organisation (Prompt 14). Read-only: nothing here changes a score.
   */
  @Get(':slug/recommendations')
  @UseGuards(OrganizationWorkspaceGuard)
  recommendations(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: RequestUser,
    @Query() query: RecommendationsQueryDto,
  ): Promise<RecommendationPage> {
    const { page, limit, ...filters } = query;
    return this.problems.listRecommended(
      workspace.organization,
      user.id,
      filters,
      page,
      limit,
    );
  }

  /** "Not relevant to us." Owners and admins, for their own organisation only. */
  @Post(':slug/recommendations/:publicId/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OrganizationWorkspaceGuard)
  @WorkspaceRoles('OWNER', 'ADMIN')
  dismiss(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: RequestUser,
    @Param('publicId') publicId: string,
  ): Promise<void> {
    return this.workspaces.setRecommendationDismissed(workspace, publicId, true, user.id);
  }

  @Post(':slug/recommendations/:publicId/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OrganizationWorkspaceGuard)
  @WorkspaceRoles('OWNER', 'ADMIN')
  restore(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: RequestUser,
    @Param('publicId') publicId: string,
  ): Promise<void> {
    return this.workspaces.setRecommendationDismissed(
      workspace,
      publicId,
      false,
      user.id,
    );
  }

  // --------------------------------------------------------- allocations

  /** Allocation requests made to this organisation. Members may read. */
  @Get(':slug/allocations')
  @UseGuards(OrganizationWorkspaceGuard)
  listAllocations(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Query() query: AllocationListQueryDto,
  ): Promise<OrganizationAllocationPage> {
    return this.allocations.listForOrganization(
      workspace,
      query.view,
      query.page,
      query.limit,
    );
  }

  @Get(':slug/allocations/:id')
  @UseGuards(OrganizationWorkspaceGuard)
  allocation(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrganizationAllocationDetail> {
    return this.allocations.detailForOrganization(workspace, id);
  }

  /** Accepts: the problem moves to IN_PROGRESS in the same transaction. */
  @Post(':slug/allocations/:id/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OrganizationWorkspaceGuard)
  @WorkspaceRoles('OWNER', 'ADMIN')
  acceptAllocation(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptAllocationDto,
  ): Promise<OrganizationAllocationDetail> {
    return this.allocations.accept(workspace, id, dto.note ?? null, user);
  }

  @Post(':slug/allocations/:id/decline')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OrganizationWorkspaceGuard)
  @WorkspaceRoles('OWNER', 'ADMIN')
  declineAllocation(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineAllocationDto,
  ): Promise<OrganizationAllocationDetail> {
    return this.allocations.decline(workspace, id, dto.reason, user);
  }
}
