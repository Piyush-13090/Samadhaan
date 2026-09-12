import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_GLOBAL_PREFIX, API_VERSION } from '@samadhaan/shared';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';

/**
 * Boots the real application — the same wiring `main.ts` uses — and exercises
 * the health endpoints end to end.
 *
 * This proves the whole foundation holds together: configuration validates,
 * every module resolves, Prisma connects to PostgreSQL, ioredis connects to
 * Redis, and the AI client reaches the FastAPI service.
 *
 * Requires PostgreSQL and Redis to be running (`docker compose up -d`). The AI
 * service is optional: when it is down, the API must report `degraded` rather
 * than fail, and that is asserted below.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Identical wiring to main.ts, via the shared bootstrap helpers.
    configureApp(app);

    await app.init();
    registerNotFoundHandler(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const url = (path = '') => `/${API_GLOBAL_PREFIX}/${API_VERSION}/health${path}`;

  it('serves liveness in the standard response envelope', async () => {
    const response = await request(app.getHttpServer()).get(url('/live')).expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.data.service).toBe('samadhaan-api');
    expect(response.body.meta.version).toBe(API_VERSION);
    expect(response.body.meta.requestId).toBeTruthy();
  });

  it('echoes a correlation id on every response', async () => {
    const response = await request(app.getHttpServer())
      .get(url('/live'))
      .set('x-request-id', 'trace-abc')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('trace-abc');
    expect(response.body.meta.requestId).toBe('trace-abc');
  });

  it('generates a correlation id when the caller does not supply one', async () => {
    const response = await request(app.getHttpServer()).get(url('/live')).expect(200);

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports every dependency it probes', async () => {
    const response = await request(app.getHttpServer()).get(url());
    const report = response.body.data;

    expect(response.body.success).toBe(true);
    expect(report.dependencies.map((d: { name: string }) => d.name).sort()).toEqual([
      'aiService',
      'database',
      'redis',
    ]);
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('connects to PostgreSQL', async () => {
    const { body } = await request(app.getHttpServer()).get(url());
    const database = body.data.dependencies.find(
      (d: { name: string }) => d.name === 'database',
    );

    expect(database.status, database.message).toBe('ok');
    expect(database.latencyMs).toBeTypeOf('number');
  });

  it('connects to Redis', async () => {
    const { body } = await request(app.getHttpServer()).get(url());
    const redis = body.data.dependencies.find(
      (d: { name: string }) => d.name === 'redis',
    );

    expect(redis.status, redis.message).toBe('ok');
  });

  it('reaches the AI service over HTTP and reports its verdict', async () => {
    const response = await request(app.getHttpServer()).get(url());
    const ai = response.body.data.dependencies.find(
      (d: { name: string }) => d.name === 'aiService',
    );

    // With no LLM credentials configured the AI service reports itself as
    // `degraded`; that verdict must reach here intact. `down` means it was
    // unreachable. Either way the API answers 200 and never crashes.
    expect(['ok', 'degraded', 'down']).toContain(ai.status);
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe(ai.status === 'ok' ? 'ok' : 'degraded');
  });

  it('returns the documented error envelope for an unknown route', async () => {
    const response = await request(app.getHttpServer())
      .get(`/${API_GLOBAL_PREFIX}/${API_VERSION}/does-not-exist`)
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.meta.requestId).toBeTruthy();
  });
});
