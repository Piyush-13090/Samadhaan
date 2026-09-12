import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { UserRole, UserStatus } from '@samadhaan/shared';
import { AppConfig } from '../../config/app.config.js';
import type { AccessTokenClaims } from '../auth.types.js';

/**
 * Mints and verifies the two token types.
 *
 * The split is deliberate:
 *
 * - **Access token** — a signed JWT, short-lived, stateless. Verified on every
 *   request without a database round trip, which is what makes it cheap. It
 *   cannot be revoked, so its lifetime is kept small.
 * - **Refresh token** — 256 bits of opaque randomness, long-lived, stateful.
 *   Carries no claims and means nothing on its own; it is only a lookup key
 *   into `sessions`. That is what makes logout and revocation real.
 *
 * Using a JWT for refresh as well would be the common mistake: it would make
 * refresh tokens unrevocable too, and logout would become a lie.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.config.jwtAccessSecret,
      expiresIn: this.config.accessTokenTtlSeconds,
    });
  }

  /**
   * Verifies an access token. Returns `null` for anything invalid — expired,
   * tampered with, wrong signature — rather than throwing, so the guard decides
   * the response and the distinction never leaks to the client.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.jwtAccessSecret,
      });

      // A token missing any expected claim is malformed, whatever its signature.
      if (!claims?.sub || !claims.sid || !claims.role) return null;

      return claims;
    } catch {
      return null;
    }
  }

  /**
   * Generates a refresh token and the digest to store.
   *
   * The plaintext goes to the client in an httpOnly cookie; only the digest is
   * persisted, so a database leak yields nothing that can be replayed.
   */
  generateRefreshToken(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hashRefreshToken(token) };
  }

  /**
   * SHA-256, not a password hash.
   *
   * Argon2 would be wrong here: it is slow by design to resist brute force
   * against low-entropy human passwords. A 256-bit random token has nothing to
   * brute-force, and this runs on every refresh — a deliberately slow hash
   * would only add latency.
   */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Constant-time digest comparison, to avoid leaking via response timing. */
  refreshTokenMatches(token: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashRefreshToken(token), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');

    // timingSafeEqual throws on a length mismatch, which would itself be a leak.
    if (actual.length !== expected.length) return false;

    return timingSafeEqual(actual, expected);
  }

  buildClaims(
    user: {
      id: string;
      email: string;
      role: UserRole;
      status: UserStatus;
    },
    sessionId: string,
  ): AccessTokenClaims {
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      sid: sessionId,
    };
  }
}
