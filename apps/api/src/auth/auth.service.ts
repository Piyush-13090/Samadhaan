import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type AuthSessionResponse,
  type AuthenticatedUser,
} from '@samadhaan/shared';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { toAuthenticatedUser } from '../users/user.serializer.js';
import { UsersRepository } from '../users/users.repository.js';
import type { RegisterDto } from './dto/register.dto.js';
import { PasswordService } from './services/password.service.js';
import { SessionService, type SessionContext } from './services/session.service.js';
import { TokenService } from './services/token.service.js';

/** Tokens the controller must place in cookies. Never returned to the client. */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  body: AuthSessionResponse;
  tokens: IssuedTokens;
}

/**
 * Registration, sign-in, refresh and sign-out.
 *
 * The service returns tokens to the controller rather than touching the
 * response itself, which keeps HTTP concerns (cookies, headers) at the edge and
 * makes this class directly unit-testable.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Creates a CITIZEN account.
   *
   * The role is hard-coded, not read from input. Organisation and government
   * accounts arrive through verification and invitation flows in later
   * milestones; until those exist there is no code path that produces a
   * privileged account from a public request.
   */
  async register(dto: RegisterDto, context: SessionContext): Promise<AuthResult> {
    const strength = this.passwords.assess(dto.password, {
      email: dto.email,
      fullName: dto.fullName,
    });

    if (strength.problems.length > 0) {
      throw new AppException(
        ERROR_CODES.VALIDATION_FAILED,
        'Choose a stronger password',
        HttpStatus.BAD_REQUEST,
        strength.problems.map((message) => ({ field: 'password', message })),
      );
    }

    const existing = await this.users.findByEmail(dto.email);

    if (existing) {
      // Registration cannot avoid disclosing that an email is taken — the
      // account must be unique — so the message stays neutral and the endpoint
      // is rate limited to make bulk enumeration impractical.
      throw AppException.conflict('An account with this email already exists', [
        { field: 'email', message: 'This email is already registered' },
      ]);
    }

    const passwordHash = await this.passwords.hash(dto.password);

    const user = await this.users.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      role: 'CITIZEN',
    });

    this.logger.log(`Registered user ${user.id}`);

    return this.startSession(user, context);
  }

  /**
   * Verifies credentials and starts a session.
   *
   * Unknown email and wrong password produce an identical error, and a dummy
   * verification runs when the email is unknown so both paths cost the same
   * time — otherwise response latency alone would reveal which emails are
   * registered.
   */
  async login(
    email: string,
    password: string,
    context: SessionContext,
  ): Promise<AuthResult> {
    const user = await this.users.findByEmail(email);

    if (!user?.passwordHash) {
      await this.passwords.verify(DUMMY_HASH, password);
      throw this.invalidCredentials();
    }

    const valid = await this.passwords.verify(user.passwordHash, password);
    if (!valid) throw this.invalidCredentials();

    if (user.status === 'SUSPENDED') {
      throw new AppException(
        ERROR_CODES.ACCOUNT_INACTIVE,
        'This account has been suspended. Contact support for help.',
        HttpStatus.FORBIDDEN,
      );
    }

    // Transparently upgrade hashes made with older Argon2 parameters. This is
    // the only moment the plaintext is available to rehash it.
    if (this.passwords.needsRehash(user.passwordHash)) {
      const upgraded = await this.passwords.hash(password);
      await this.users.updatePasswordHash(user.id, upgraded);
    }

    const updated = await this.users.recordLogin(user.id);

    return this.startSession(updated, context);
  }

  /**
   * Rotates a refresh token.
   *
   * Any failure yields the same generic error: a specific reason would let an
   * attacker distinguish "this token existed but expired" from "this token was
   * never valid".
   */
  async refresh(refreshToken: string, context: SessionContext): Promise<AuthResult> {
    const rotated = await this.sessions.rotate(refreshToken, context);
    if (!rotated) throw this.sessionExpired();

    const user = await this.users.findById(rotated.session.userId);
    if (!user || user.status === 'SUSPENDED') {
      await this.sessions.revoke(rotated.session.id);
      throw this.sessionExpired();
    }

    const accessToken = await this.tokens.issueAccessToken(
      this.tokens.buildClaims(user, rotated.session.id),
    );

    return {
      body: this.buildBody(toAuthenticatedUser(user)),
      tokens: { accessToken, refreshToken: rotated.refreshToken },
    };
  }

  /**
   * Signs out.
   *
   * Revokes by session id when the request is authenticated, and additionally
   * by refresh token so an expired access token does not prevent sign-out —
   * a user whose token lapsed must still be able to end their session.
   */
  async logout(options: { sessionId?: string; refreshToken?: string }): Promise<void> {
    if (options.sessionId) await this.sessions.revoke(options.sessionId);
    if (options.refreshToken) await this.sessions.revokeByToken(options.refreshToken);
  }

  /** Signs the user out on every device. */
  async logoutEverywhere(userId: string): Promise<void> {
    await this.sessions.revokeAllForUser(userId);
  }

  private async startSession(
    user: Parameters<typeof toAuthenticatedUser>[0],
    context: SessionContext,
  ): Promise<AuthResult> {
    const { session, refreshToken } = await this.sessions.create(user.id, context);
    const accessToken = await this.tokens.issueAccessToken(
      this.tokens.buildClaims(user, session.id),
    );

    return {
      body: this.buildBody(toAuthenticatedUser(user)),
      tokens: { accessToken, refreshToken },
    };
  }

  private buildBody(user: AuthenticatedUser): AuthSessionResponse {
    return { user, expiresIn: this.config.accessTokenTtlSeconds };
  }

  private invalidCredentials(): AppException {
    return new AppException(
      ERROR_CODES.INVALID_CREDENTIALS,
      'Incorrect email or password',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private sessionExpired(): AppException {
    return new AppException(
      ERROR_CODES.SESSION_EXPIRED,
      'Your session has expired. Please sign in again.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/**
 * A real Argon2id hash of a value nobody knows, verified against submitted
 * passwords when the email is unknown. Its only purpose is to make the failure
 * path take the same time as the success path.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FtYWRoYWFuLWR1bW15LXNhbHQ$1M9hFiKqZCJMHTVBcGGmrlyFZ5rqJoTFqQmTKe0kMFs';
