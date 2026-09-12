import { Injectable, Logger } from '@nestjs/common';
import type { Session } from '../../generated/prisma/client.js';
import { AppConfig } from '../../config/app.config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TokenService } from './token.service.js';

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * The lifecycle of refresh sessions — the component that makes logout real.
 *
 * Access tokens are stateless and cannot be recalled, so revocation lives
 * entirely here: delete or revoke the session row and the refresh token that
 * points at it stops working, which bounds any stolen access token to its
 * remaining few minutes.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  /** Creates a session and returns the plaintext refresh token (shown once). */
  async create(
    userId: string,
    context: SessionContext = {},
  ): Promise<{ session: Session; refreshToken: string }> {
    const { token, tokenHash } = this.tokens.generateRefreshToken();

    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash,
        userAgent: context.userAgent?.slice(0, 512),
        ipAddress: context.ipAddress,
        expiresAt: new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000),
      },
    });

    return { session, refreshToken: token };
  }

  /**
   * Exchanges a refresh token for a new one, rotating the session.
   *
   * Rotation plus reuse detection: each refresh token is single-use, so if one
   * is presented twice the second attempt is either a replay or a race with a
   * stolen token. Since we cannot tell which, every session for that user is
   * revoked — the safe response to a credential that may be in two places.
   *
   * Returns `null` for any invalid token; the caller turns that into a generic
   * failure so the reason is never disclosed.
   */
  async rotate(
    refreshToken: string,
    context: SessionContext = {},
  ): Promise<{ session: Session; refreshToken: string } | null> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);

    const existing = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) return null;

    if (existing.revokedAt) {
      // A revoked token being presented means it was captured before logout,
      // or this is a replay. Either way, assume compromise.
      this.logger.warn(
        `Refresh token reuse detected for user ${existing.userId}; revoking all sessions`,
      );
      await this.revokeAllForUser(existing.userId);
      return null;
    }

    if (existing.expiresAt <= new Date()) return null;
    if (existing.user.deletedAt || existing.user.status === 'SUSPENDED') return null;

    const { token, tokenHash: nextHash } = this.tokens.generateRefreshToken();

    // Rotate in one transaction: the old token must stop working at exactly the
    // moment the new one starts, with no window where both or neither work.
    const [, session] = await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.session.create({
        data: {
          userId: existing.userId,
          tokenHash: nextHash,
          userAgent: context.userAgent?.slice(0, 512) ?? existing.userAgent,
          ipAddress: context.ipAddress ?? existing.ipAddress,
          expiresAt: new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000),
        },
      }),
    ]);

    return { session, refreshToken: token };
  }

  /** Finds a live session by id. Used by the guard to confirm it still exists. */
  async findActive(sessionId: string): Promise<Session | null> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

    return session;
  }

  /** Revokes one session — what sign-out on this device does. */
  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes a refresh token without needing its session id. */
  async revokeByToken(refreshToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Signs the user out everywhere. Used on password change and on compromise. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Records activity, for the future "your devices" screen. */
  async touch(sessionId: string): Promise<void> {
    await this.prisma.session
      .updateMany({ where: { id: sessionId }, data: { lastUsedAt: new Date() } })
      .catch(() => {
        // Best-effort bookkeeping; never fail a request over it.
      });
  }
}
