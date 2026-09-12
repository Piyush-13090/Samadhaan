import { Body, Controller, Get, Patch } from '@nestjs/common';
import { API_VERSION, type AuthenticatedUser } from '@samadhaan/shared';
import { AppException } from '../common/app.exception.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { RequestUser } from '../auth/auth.types.js';
import { UpdateProfileDto } from '../auth/dto/register.dto.js';
import { toAuthenticatedUser } from './user.serializer.js';
import { UsersRepository } from './users.repository.js';

@Controller({ path: 'users', version: API_VERSION.replace('v', '') })
export class UsersController {
  constructor(private readonly users: UsersRepository) {}

  /** The current user's profile. Same payload as `/auth/me`. */
  @Get('me')
  async me(@CurrentUser() principal: RequestUser): Promise<AuthenticatedUser> {
    const user = await this.users.findById(principal.id);
    if (!user) throw AppException.unauthorized();

    return toAuthenticatedUser(user);
  }

  /**
   * Updates the current user's own profile.
   *
   * Two things make privilege escalation impossible here, independently:
   * `UpdateProfileDto` has no `role` or `status` field and the global
   * `ValidationPipe` rejects unknown properties, and `updateProfile` accepts
   * only `ProfileUpdate`. The id comes from the verified token, never from the
   * body or a path parameter — which is what rules out editing another account
   * by guessing its id.
   */
  @Patch('me')
  async updateMe(
    @CurrentUser() principal: RequestUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<AuthenticatedUser> {
    if (dto.displayName) {
      const taken = await this.users.findByDisplayName(dto.displayName);

      if (taken && taken.id !== principal.id) {
        throw AppException.conflict('That display name is taken', [
          { field: 'displayName', message: 'Choose a different display name' },
        ]);
      }
    }

    const updated = await this.users.updateProfile(principal.id, dto);

    return toAuthenticatedUser(updated);
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
}
