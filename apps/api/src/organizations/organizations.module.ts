import { Module } from '@nestjs/common';
import { OrganizationAccessService } from './organization-access.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * Organisation profiles, membership and expertise.
 *
 * `OrganizationAccessService` is exported because later milestones — allocation
 * and resolution rooms — need the same authorisation rules. Re-deriving them
 * there is how two subtly different definitions of "may manage this
 * organisation" end up in the codebase.
 */
@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationAccessService],
  exports: [OrganizationsService, OrganizationAccessService],
})
export class OrganizationsModule {}
