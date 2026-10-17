import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { AppConfig } from './app.config.js';
import { validateEnv, type Env } from './env.schema.js';

function createConfig(overrides: Record<string, unknown> = {}): AppConfig {
  const env = validateEnv({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    AI_SERVICE_URL: 'http://localhost:8000',
    JWT_ACCESS_SECRET: 'test-secret-value-at-least-32-characters-long',
    ...overrides,
  });

  return new AppConfig(new ConfigService<Env, true>(env));
}

describe('AppConfig', () => {
  it('splits and trims the CORS allow-list', () => {
    const config = createConfig({
      CORS_ORIGINS: 'http://localhost:3000, https://samadhaan.app ,',
    });

    expect(config.corsOrigins).toEqual([
      'http://localhost:3000',
      'https://samadhaan.app',
    ]);
  });

  it('defaults the database pool to node-postgres sizing with a bounded wait', () => {
    expect(createConfig().databasePool).toEqual({
      max: 10,
      acquireTimeoutMs: 10_000,
      statementTimeoutMs: 0,
    });
    expect(
      createConfig({ DATABASE_POOL_MAX: '25', DATABASE_STATEMENT_TIMEOUT_MS: '30000' })
        .databasePool,
    ).toEqual({ max: 25, acquireTimeoutMs: 10_000, statementTimeoutMs: 30_000 });
    expect(() => createConfig({ DATABASE_POOL_MAX: '0' })).toThrow();
  });

  it('strips trailing slashes from the AI service URL so path joins stay correct', () => {
    const config = createConfig({ AI_SERVICE_URL: 'http://localhost:8000///' });

    expect(config.aiServiceUrl).toBe('http://localhost:8000');
  });

  it('reports the environment flags consistently', () => {
    const production = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'Zq8vN2kR7tXw4pLmC9bJ5hGfD3sA6yE1uIoP0nKjHgFdSaQw',
      AI_SERVICE_TOKEN: 'k'.repeat(20) + 'm'.repeat(20),
      AUTH_COOKIE_SECURE: 'true',
      CORS_ORIGINS: 'https://samadhaan.app',
    };
    expect(createConfig(production).isProduction).toBe(true);
    expect(createConfig(production).isDevelopment).toBe(false);
    // An unhardened production configuration refuses to load (Prompt 26).
    expect(() => createConfig({ NODE_ENV: 'production' })).toThrow(
      /Unsafe production configuration/,
    );
    expect(createConfig().isDevelopment).toBe(true);
  });
});
