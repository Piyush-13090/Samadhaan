import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  API_VERSION,
  type AuthSessionResponse,
  type AuthenticatedUser,
} from '@samadhaan/shared';
import { AppException } from '../common/app.exception.js';
import { toAuthenticatedUser } from '../users/user.serializer.js';
import { UsersRepository } from '../users/users.repository.js';
import { AuthService, type IssuedTokens } from './auth.service.js';
import type { RequestUser } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { RateLimit } from './guards/rate-limit.guard.js';
import { AuthCookiesService } from './services/auth-cookies.service.js';
import type { SessionContext } from './services/session.service.js';

@Controller({ path: 'auth', version: API_VERSION.replace('v', '') })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookiesService,
    private readonly users: UsersRepository,
  ) {}

  /**
   * Creates a CITIZEN account and signs in.
   *
   * Rate limited by IP and email so the endpoint cannot be used to bulk-probe
   * which addresses are registered, nor to mass-create accounts.
   */
  @Public()
  @RateLimit({ max: 5, windowSeconds: 3600, keyField: 'email' })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const result = await this.auth.register(dto, this.contextFrom(request));
    this.applyTokens(response, result.tokens);
    return result.body;
  }

  /** Verifies credentials and starts a session. */
  @Public()
  @RateLimit({ keyField: 'email' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const result = await this.auth.login(
      dto.email,
      dto.password,
      this.contextFrom(request),
    );
    this.applyTokens(response, result.tokens);
    return result.body;
  }

  /**
   * Exchanges the refresh cookie for a new token pair.
   *
   * Public because the access token is expected to be expired by the time this
   * is called — requiring authentication would make refresh impossible. The
   * refresh cookie is the credential, and it is verified against the database.
   */
  @Public()
  @RateLimit({ max: 30, windowSeconds: 300 })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const refreshToken = this.cookies.readRefreshToken(request);

    if (!refreshToken) {
      this.cookies.clear(response);
      throw AppException.unauthorized('Your session has expired. Please sign in again.');
    }

    try {
      const result = await this.auth.refresh(refreshToken, this.contextFrom(request));
      this.applyTokens(response, result.tokens);
      return result.body;
    } catch (error) {
      // Clear cookies on failure so the browser stops resending a dead token.
      this.cookies.clear(response);
      throw error;
    }
  }

  /**
   * Ends the session.
   *
   * Public so an expired access token does not trap a user in a signed-in UI
   * they cannot leave. The session is identified by the refresh cookie, and by
   * the access token as well when it is still valid.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout({ refreshToken: this.cookies.readRefreshToken(request) });
    this.cookies.clear(response);
  }

  /** Revokes every session for the current user. */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutEverywhere(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logoutEverywhere(user.id);
    this.cookies.clear(response);
  }

  /**
   * The current user.
   *
   * Reads from the database rather than echoing the token claims, so a profile
   * change is reflected immediately instead of after the access token rotates.
   */
  @Get('me')
  async me(@CurrentUser() principal: RequestUser): Promise<AuthenticatedUser> {
    const user = await this.users.findById(principal.id);

    // The guard verified the session, so absence means the account was deleted
    // mid-session.
    if (!user) throw AppException.unauthorized();

    return toAuthenticatedUser(user);
  }

  private applyTokens(response: Response, tokens: IssuedTokens): void {
    this.cookies.setAccessToken(response, tokens.accessToken);
    this.cookies.setRefreshToken(response, tokens.refreshToken);
  }

  /** Captures device context for the session record. */
  private contextFrom(request: Request): SessionContext {
    return {
      userAgent: request.get('user-agent'),
      ipAddress: request.ip,
    };
  }
}
