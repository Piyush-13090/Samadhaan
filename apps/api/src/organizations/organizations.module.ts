import { Module } from '@nestjs/common';
import { AllocationsModule } from '../allocations/allocations.module.js';
import { ResolutionModule } from '../resolution/resolution.module.js';
import { OrganizationAccessService } from './organization-access.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';
import { OrganizationProblemsService } from './workspace/organization-problems.service.js';
import { OrganizationWorkspaceController } from './workspace/organization-workspace.controller.js';
import { OrganizationWorkspaceGuard } from './workspace/organization-workspace.guard.js';
import { OrganizationWorkspaceService } from './workspace/organization-workspace.service.js';

/**
 * Organisation profiles, membership and expertise, and the workspace NGO,
 * university and industry members work in.
 *
 * `OrganizationAccessService` is exported because later milestones — allocation
 * and resolution rooms — need the same authorisation rules. Re-deriving them
 * there is how two subtly different definitions of "may manage this
 * organisation" end up in the codebase.
 */
@Module({
  imports: [AllocationsModule, ResolutionModule],
  // Workspace first: its literal `mine` and `invitations` routes must be
  // registered before the public `:slug` profile route would swallow them.
  controllers: [OrganizationWorkspaceController, OrganizationsController],
  providers: [
    OrganizationsService,
    OrganizationAccessService,
    OrganizationWorkspaceGuard,
    OrganizationWorkspaceService,
    OrganizationProblemsService,
  ],
  exports: [OrganizationsService, OrganizationAccessService],
})
export class OrganizationsModule {}
