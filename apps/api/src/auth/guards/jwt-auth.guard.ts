import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ERROR_CODES } from '@samadhaan/shared';
import { AppException } from '../../common/app.exception.js';
import type { AuthenticatedRequest } from '../auth.types.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { AuthCookiesService } from '../services/auth-cookies.service.js';
import { SessionService } from '../services/session.service.js';
import { TokenService } from '../services/token.service.js';

/**
 * Authentication. Registered globally, so every route is protected unless it
 * opts out with `@Public()` — a new endpoint is closed by default, and opening
 * it is a visible, greppable decision.
 *
 * Two checks, not one:
 *
 *  1. The access-token JWT verifies (signature and expiry).
 *  2. The session it was issued against still exists and is not revoked.
 *
 * The second is what makes sign-out take effect immediately. Without it a
 * logged-out user would keep access until their token expired, and "sign out
 * everywhere" could not work at all. It costs one indexed lookup per request,
 * which is the right trade for revocation that is actually true.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly cookies: AuthCookiesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const token = this.cookies.readAccessToken(request);

    if (!token) throw this.sessionExpired();

    const claims = await this.tokens.verifyAccessToken(token);
    if (!claims) throw this.sessionExpired();

    const session = await this.sessions.findActive(claims.sid);
    if (!session || session.userId !== claims.sub) throw this.sessionExpired();

    // A suspended account keeps a valid token until it expires; refuse here so
    // suspension takes effect immediately rather than up to 15 minutes later.
    if (claims.status === 'SUSPENDED') {
      throw new AppException(
        ERROR_CODES.ACCOUNT_INACTIVE,
        'This account has been suspended',
        HttpStatus.FORBIDDEN,
      );
    }

    request.user = {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      status: claims.status,
      sessionId: claims.sid,
    };

    return true;
  }

  /**
   * One response for every authentication failure.
   *
   * Missing, malformed, expired and revoked are indistinguishable to the
   * client on purpose — distinguishing them tells an attacker which of their
   * guesses was closer. The client's only correct reaction is the same in all
   * four cases: try to refresh, then sign in.
   */
  private sessionExpired(): AppException {
    return new AppException(
      ERROR_CODES.SESSION_EXPIRED,
      'Your session has expired. Please sign in again.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
