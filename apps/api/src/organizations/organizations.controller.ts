import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  API_VERSION,
  type OrganizationActivity,
  type OrganizationExpertiseEntry,
  type OrganizationMemberSummary,
  type PublicOrganization,
} from '@samadhaan/shared';
import type { AuthenticatedRequest, RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import {
  CreateExpertiseDto,
  UpdateMemberDto,
  UpdateOrganizationDto,
} from './dto/organization.dto.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * Organisation profiles.
 *
 * Read endpoints are `@Public()` — an organisation profile is a public civic
 * record, and requiring a session to view one would defeat the purpose. Every
 * write is authorised inside the service via `OrganizationAccessService`, never
 * by a role check in this file, so the rules live in one auditable place.
 */
@Controller({ path: 'organizations', version: API_VERSION.replace('v', '') })
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /**
   * Reads the principal from a `@Public()` route.
   *
   * `@CurrentUser()` cannot be used here: it is typed non-optional because it
   * runs behind the auth guard, which a public route skips. On these routes the
   * viewer may legitimately be absent, and the response adapts.
   */
  private viewerFrom(request: Request): RequestUser | null {
    return (request as Request & AuthenticatedRequest).user ?? null;
  }

  /** Public profile by slug. */
  @Public()
  @Get(':slug')
  findBySlug(
    @Param('slug') slug: string,
    @Req() request: Request,
  ): Promise<PublicOrganization> {
    return this.organizations.findBySlug(slug, this.viewerFrom(request));
  }

  /** Civic contribution counts. Real counts only. */
  @Public()
  @Get(':id/activity')
  activity(@Param('id', ParseUUIDPipe) id: string): Promise<OrganizationActivity> {
    return this.organizations.getActivity(id);
  }

  /** Team roster. Managers additionally see pending invitations. */
  @Public()
  @Get(':id/members')
  members(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<OrganizationMemberSummary[]> {
    return this.organizations.listMembers(id, this.viewerFrom(request));
  }

  @Public()
  @Get(':id/expertise')
  expertise(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrganizationExpertiseEntry[]> {
    return this.organizations.listExpertise(id);
  }

  /** Requires OWNER/ADMIN membership, or platform ADMIN. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PublicOrganization> {
    return this.organizations.update(id, dto, user);
  }

  @Post(':id/expertise')
  @HttpCode(HttpStatus.CREATED)
  addExpertise(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExpertiseDto,
    @CurrentUser() user: RequestUser,
  ): Promise<OrganizationExpertiseEntry> {
    return this.organizations.addExpertise(id, dto, user);
  }

  @Delete(':id/expertise/:expertiseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeExpertise(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('expertiseId', ParseUUIDPipe) expertiseId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.organizations.removeExpertise(id, expertiseId, user);
  }

  @Patch(':id/members/:memberId')
  updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() user: RequestUser,
  ): Promise<OrganizationMemberSummary> {
    return this.organizations.updateMemberRole(id, memberId, dto.membershipRole, user);
  }

  @Delete(':id/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.organizations.removeMember(id, memberId, user);
  }
}
