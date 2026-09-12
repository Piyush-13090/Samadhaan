import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '@samadhaan/shared';
import { AppException } from '../../common/app.exception.js';
import type { AuthenticatedRequest } from '../auth.types.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * Authorisation — the second half of access control.
 *
 * Runs after `JwtAuthGuard`, so by the time it executes the principal is known
 * and this only answers "may *this* user do *this*".
 *
 * Registered globally alongside the auth guard: a route with no `@Roles()` is
 * open to any authenticated user, and one with `@Roles(...)` is restricted. The
 * point is that the restriction lives in the route signature, not scattered
 * through handler bodies where it is easy to omit and impossible to audit.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() means "any authenticated user" — authentication already ran.
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      // Only reachable if this guard is somehow ordered before authentication.
      throw AppException.forbidden();
    }

    if (!required.includes(user.role)) {
      // Deliberately does not name the required role: telling a citizen that an
      // endpoint needs GOVERNMENT maps the privileged surface for them.
      throw AppException.forbidden('You do not have access to this resource');
    }

    return true;
  }
}
