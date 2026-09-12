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

  it('strips trailing slashes from the AI service URL so path joins stay correct', () => {
    const config = createConfig({ AI_SERVICE_URL: 'http://localhost:8000///' });

    expect(config.aiServiceUrl).toBe('http://localhost:8000');
  });

  it('reports the environment flags consistently', () => {
    expect(createConfig({ NODE_ENV: 'production' }).isProduction).toBe(true);
    expect(createConfig({ NODE_ENV: 'production' }).isDevelopment).toBe(false);
    expect(createConfig().isDevelopment).toBe(true);
  });
});
