import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

const VALID = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  AI_SERVICE_URL: 'http://localhost:8000',
  // Required since the authentication milestone; minimum 32 characters.
  JWT_ACCESS_SECRET: 'test-secret-value-at-least-32-characters-long',
};

describe('validateEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = validateEnv({ ...VALID });

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('coerces numeric variables, which arrive as strings', () => {
    const env = validateEnv({ ...VALID, API_PORT: '8080' });

    expect(env.API_PORT).toBe(8080);
    expect(typeof env.API_PORT).toBe('number');
  });

  it('fails fast when a required variable is missing', () => {
    expect(() => validateEnv({ REDIS_URL: VALID.REDIS_URL })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects a JWT secret short enough to be guessable', () => {
    expect(() => validateEnv({ ...VALID, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('parses the boolean-shaped auth flags into real booleans', () => {
    const env = validateEnv({
      ...VALID,
      AUTH_COOKIE_SECURE: 'true',
      ALLOW_DEV_SEED: 'false',
    });

    expect(env.AUTH_COOKIE_SECURE).toBe(true);
    expect(env.ALLOW_DEV_SEED).toBe(false);
  });

  it('defaults the seed guard to disabled, so seeding is always opt-in', () => {
    expect(validateEnv({ ...VALID }).ALLOW_DEV_SEED).toBe(false);
  });

  it('names every offending variable so a misconfiguration is actionable', () => {
    expect(() => validateEnv({ ...VALID, DATABASE_URL: 'not-a-url' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects an unknown NODE_ENV rather than silently treating it as production', () => {
    expect(() => validateEnv({ ...VALID, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
