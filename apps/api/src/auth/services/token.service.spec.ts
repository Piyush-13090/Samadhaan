import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app.config.js';
import { TokenService } from './token.service.js';

const config = {
  jwtAccessSecret: 'a-test-secret-that-is-at-least-32-characters-long',
  accessTokenTtlSeconds: 900,
} as AppConfig;

function createService(overrides: Partial<AppConfig> = {}): TokenService {
  return new TokenService(new JwtService(), { ...config, ...overrides } as AppConfig);
}

describe('TokenService', () => {
  describe('access tokens', () => {
    it('round-trips claims through a signed token', async () => {
      const service = createService();
      const claims = service.buildClaims(
        { id: 'u1', email: 'a@b.c', role: 'CITIZEN', status: 'ACTIVE' },
        'sess-1',
      );

      const verified = await service.verifyAccessToken(
        await service.issueAccessToken(claims),
      );

      expect(verified).toMatchObject({ sub: 'u1', role: 'CITIZEN', sid: 'sess-1' });
    });

    it('rejects a token signed with a different secret', async () => {
      const issued = await createService().issueAccessToken(
        createService().buildClaims(
          { id: 'u1', email: 'a@b.c', role: 'CITIZEN', status: 'ACTIVE' },
          'sess-1',
        ),
      );

      const other = createService({
        jwtAccessSecret: 'a-completely-different-secret-of-sufficient-length',
      });

      await expect(other.verifyAccessToken(issued)).resolves.toBeNull();
    });

    it('rejects a tampered token rather than throwing', async () => {
      await expect(createService().verifyAccessToken('not.a.jwt')).resolves.toBeNull();
    });

    it('rejects an expired token', async () => {
      const service = createService({ accessTokenTtlSeconds: -1 } as Partial<AppConfig>);
      const token = await service.issueAccessToken(
        service.buildClaims(
          { id: 'u1', email: 'a@b.c', role: 'CITIZEN', status: 'ACTIVE' },
          'sess-1',
        ),
      );

      await expect(service.verifyAccessToken(token)).resolves.toBeNull();
    });
  });

  describe('refresh tokens', () => {
    it('generates a high-entropy token and a matching digest', () => {
      const service = createService();
      const { token, tokenHash } = service.generateRefreshToken();

      // 32 random bytes in base64url.
      expect(token.length).toBeGreaterThanOrEqual(43);
      expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(tokenHash).not.toContain(token);
    });

    it('never repeats a token', () => {
      const service = createService();
      const tokens = new Set(
        Array.from({ length: 50 }, () => service.generateRefreshToken().token),
      );

      expect(tokens.size).toBe(50);
    });

    it('matches a token against its own digest', () => {
      const service = createService();
      const { token, tokenHash } = service.generateRefreshToken();

      expect(service.refreshTokenMatches(token, tokenHash)).toBe(true);
    });

    it('rejects a different token', () => {
      const service = createService();
      const { tokenHash } = service.generateRefreshToken();
      const other = service.generateRefreshToken().token;

      expect(service.refreshTokenMatches(other, tokenHash)).toBe(false);
    });

    it('rejects a malformed digest without throwing on length mismatch', () => {
      const service = createService();
      const { token } = service.generateRefreshToken();

      expect(service.refreshTokenMatches(token, 'abc')).toBe(false);
    });
  });
});
