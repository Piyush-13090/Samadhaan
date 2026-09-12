import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@samadhaan/shared';

export const ROLES_KEY = 'samadhaan:roles';

/**
 * Restricts a route to the listed roles.
 *
 *   @Roles('GOVERNMENT', 'ADMIN')
 *   @Get('queue')
 *   getQueue() { … }
 *
 * The decorator only records intent; `RolesGuard` enforces it. Keeping the
 * check in a guard rather than inside handlers means authorisation is visible
 * in the route signature and cannot be forgotten halfway down a method.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
