import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  describe('hashing', () => {
    it('produces an argon2id hash, never the plaintext', async () => {
      const hash = await service.hash('CorrectHorseBattery9');

      expect(hash).toMatch(/^\$argon2id\$/);
      expect(hash).not.toContain('CorrectHorseBattery9');
    });

    it('salts each hash, so identical passwords store differently', async () => {
      const [first, second] = await Promise.all([
        service.hash('CorrectHorseBattery9'),
        service.hash('CorrectHorseBattery9'),
      ]);

      expect(first).not.toBe(second);
    });

    it('verifies a correct password', async () => {
      const hash = await service.hash('CorrectHorseBattery9');

      await expect(service.verify(hash, 'CorrectHorseBattery9')).resolves.toBe(true);
    });

    it('rejects an incorrect password', async () => {
      const hash = await service.hash('CorrectHorseBattery9');

      await expect(service.verify(hash, 'WrongHorseBattery9')).resolves.toBe(false);
    });

    it('returns false rather than throwing on a malformed stored hash', async () => {
      await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
    });
  });

  describe('strength assessment', () => {
    it('accepts a long, mixed password', () => {
      expect(service.assess('Monsoon-Drain-2026').problems).toEqual([]);
    });

    it('rejects a password below the minimum length', () => {
      expect(service.assess('Short1!').problems).toContainEqual(
        expect.stringContaining('at least'),
      );
    });

    it('rejects a well-known password even when long enough', () => {
      expect(service.assess('password123').problems).toContainEqual(
        expect.stringContaining('too common'),
      );
    });

    it('rejects a password containing the email local part', () => {
      const result = service.assess('priyasharma2026', {
        email: 'priyasharma@example.com',
      });

      expect(result.problems).toContainEqual(expect.stringContaining('email'));
    });

    it('rejects a password containing the user’s name', () => {
      const result = service.assess('SharmaSharma11', { fullName: 'Priya Sharma' });

      expect(result.problems).toContainEqual(expect.stringContaining('name'));
    });

    it('rejects a single repeated character', () => {
      expect(service.assess('aaaaaaaaaaaa').problems).toContainEqual(
        expect.stringContaining('repeat'),
      );
    });

    it('caps the score when a problem is present, so weak passwords cannot score well', () => {
      expect(
        service.assess('Password123!aaa', { email: 'x@y.com' }).score,
      ).toBeLessThanOrEqual(4);
      expect(service.assess('password123').score).toBeLessThanOrEqual(1);
    });
  });
});
