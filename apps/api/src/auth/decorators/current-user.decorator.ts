import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, RequestUser } from '../auth.types.js';

/**
 * Injects the authenticated principal into a handler.
 *
 *   @Get('me')
 *   me(@CurrentUser() user: RequestUser) { … }
 *
 * Typed as non-optional because `JwtAuthGuard` runs first on every protected
 * route: if the handler executes, a user is present. On a `@Public()` route it
 * would be undefined, which is why public handlers must not use this.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      throw new Error(
        'CurrentUser used on a route without JwtAuthGuard. Remove @Public() or the decorator.',
      );
    }

    return request.user;
  },
);
