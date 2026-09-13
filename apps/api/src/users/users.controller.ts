import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  API_VERSION,
  type AuthenticatedUser,
  type OwnProfile,
  type ProfileActivity,
  type PublicProfile,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AppException } from '../common/app.exception.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { toAuthenticatedUser, toOwnProfile, toPublicProfile } from './user.serializer.js';
import { UsersRepository } from './users.repository.js';

@Controller({ path: 'users', version: API_VERSION.replace('v', '') })
export class UsersController {
  constructor(private readonly users: UsersRepository) {}

  /**
   * The signed-in user's own profile, including their private account fields
   * and any outstanding organisation invitations.
   */
  @Get('me')
  async me(@CurrentUser() principal: RequestUser): Promise<OwnProfile> {
    const user = await this.users.findByIdWithMemberships(principal.id);
    if (!user) throw AppException.unauthorized();

    return toOwnProfile(user, user.organizationMembers);
  }

  /** Civic activity counts for the signed-in user. Real counts only. */
  @Get('me/activity')
  activity(@CurrentUser() principal: RequestUser): Promise<ProfileActivity> {
    return this.users.getActivity(principal.id);
  }

  /**
   * Updates the current user's own profile.
   *
   * Three independent barriers stop this becoming privilege escalation:
   * `UpdateProfileDto` has no `role` or `status` field and validation rejects
   * unknown properties; `ProfileUpdate` cannot express them either; and the id
   * comes from the verified token, never from the body or a path parameter —
   * which is what rules out editing another account by guessing its id.
   */
  @Patch('me')
  async updateMe(
    @CurrentUser() principal: RequestUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<OwnProfile> {
    if (dto.displayName) {
      const taken = await this.users.findByDisplayName(dto.displayName);

      if (taken && taken.id !== principal.id) {
        throw AppException.conflict('That display name is taken', [
          { field: 'displayName', message: 'Choose a different display name' },
        ]);
      }
    }

    await this.users.updateProfile(principal.id, dto);

    // Re-read with memberships so the response is the same shape as GET,
    // rather than a partial the client has to reconcile.
    const updated = await this.users.findByIdWithMemberships(principal.id);
    if (!updated) throw AppException.unauthorized();

    return toOwnProfile(updated, updated.organizationMembers);
  }

  /**
   * A user's public profile, by handle.
   *
   * Public by design — civic contribution is a public record. The serializer,
   * not this handler, is what guarantees email, phone and account status stay
   * out of the response.
   */
  @Public()
  @Get('by-handle/:displayName')
  async byHandle(
    @Param('displayName') displayName: string,
  ): Promise<{ profile: PublicProfile; activity: ProfileActivity }> {
    const user = await this.users.findByDisplayNameWithMemberships(displayName);
    if (!user) throw AppException.notFound('Profile');

    // A suspended account's profile is withdrawn from public view; the same
    // 404 as a missing one, so the endpoint does not report who is suspended.
    if (user.status === 'SUSPENDED') throw AppException.notFound('Profile');

    return {
      profile: toPublicProfile(user, user.organizationMembers),
      activity: await this.users.getActivity(user.id),
    };
  }

  /**
   * Administrative user count.
   *
   * Exists mainly to demonstrate — and test — that `@Roles` is enforced by the
   * backend rather than merely reflected in the UI. The full user-management
   * surface belongs to the admin milestone.
   */
  @Roles('ADMIN')
  @Get('count')
  async count(): Promise<{ total: number }> {
    return { total: await this.users.count() };
  }

  /** Session-shaped payload, kept for compatibility with `/auth/me`. */
  @Get('me/session')
  async session(@CurrentUser() principal: RequestUser): Promise<AuthenticatedUser> {
    const user = await this.users.findById(principal.id);
    if (!user) throw AppException.unauthorized();

    return toAuthenticatedUser(user);
  }
}
