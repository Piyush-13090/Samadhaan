import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@samadhaan/shared';
import type { AiService } from '../ai/ai.service.js';
import type { AppConfig } from '../config/app.config.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { RedisService } from '../redis/redis.service.js';
import { HealthService } from './health.service.js';

/** Builds a HealthService whose dependencies each report the given outcome. */
function createService(options: {
  database?: boolean;
  redis?: boolean;
  ai?: 'ok' | 'degraded' | null;
}) {
  const { database = true, redis = true, ai = 'ok' } = options;

  return new HealthService(
    { nodeEnv: 'test' } as AppConfig,
    {
      ping: vi.fn(async () => (database ? ok(true) : err(new Error('db unreachable')))),
    } as unknown as PrismaService,
    {
      ping: vi.fn(async () => (redis ? ok(true) : err(new Error('redis unreachable')))),
    } as unknown as RedisService,
    {
      getHealth: vi.fn(async () =>
        ai === null
          ? null
          : {
              status: ai,
              dependencies:
                ai === 'ok'
                  ? [{ name: 'llmProvider', status: 'ok' }]
                  : [{ name: 'llmProvider', status: 'degraded' }],
            },
      ),
    } as unknown as AiService,
  );
}

function dependency(
  report: Awaited<ReturnType<HealthService['getReadiness']>>,
  name: string,
) {
  const found = report.dependencies.find((entry) => entry.name === name);
  if (!found) throw new Error(`No dependency named ${name}`);
  return found;
}

describe('HealthService', () => {
  let service: HealthService;

  describe('liveness', () => {
    beforeEach(() => {
      service = createService({});
    });

    it('reports ok without touching dependencies', () => {
      expect(service.getLiveness().status).toBe('ok');
      expect(service.getLiveness().service).toBe('samadhaan-api');
    });
  });

  describe('readiness', () => {
    it('reports ok when every dependency responds', async () => {
      const report = await createService({}).getReadiness();

      expect(report.status).toBe('ok');
      expect(report.dependencies).toHaveLength(3);
      expect(report.dependencies.every((d) => d.status === 'ok')).toBe(true);
    });

    it('measures each probe so a slow dependency is visible', async () => {
      const report = await createService({}).getReadiness();

      expect(dependency(report, 'database').latencyMs).toBeTypeOf('number');
    });

    it('is down when PostgreSQL is unreachable — nothing works without it', async () => {
      const report = await createService({ database: false }).getReadiness();

      expect(report.status).toBe('down');
      expect(dependency(report, 'database').status).toBe('down');
      expect(dependency(report, 'database').message).toContain('db unreachable');
    });

    it('is only degraded when Redis is unreachable — reads still work', async () => {
      const report = await createService({ redis: false }).getReadiness();

      expect(report.status).toBe('degraded');
      expect(dependency(report, 'redis').status).toBe('down');
    });

    it('is only degraded when the AI service is unreachable', async () => {
      const report = await createService({ ai: null }).getReadiness();

      expect(report.status).toBe('degraded');
      expect(dependency(report, 'aiService').message).toContain('unreachable');
    });

    it("passes the AI service's own degraded verdict through, rather than flattening it to down", async () => {
      const report = await createService({ ai: 'degraded' }).getReadiness();

      // The service is reachable; only its capabilities are limited.
      expect(dependency(report, 'aiService').status).toBe('degraded');
      expect(report.status).toBe('degraded');
    });

    it('names the AI service dependencies that are failing', async () => {
      const report = await createService({ ai: 'degraded' }).getReadiness();

      expect(dependency(report, 'aiService').message).toContain('llmProvider');
    });

    it('reports the worst status when several dependencies fail', async () => {
      const report = await createService({
        database: false,
        redis: false,
        ai: null,
      }).getReadiness();

      expect(report.status).toBe('down');
    });

    it('never throws, so /health stays observable when everything is broken', async () => {
      const service = new HealthService(
        { nodeEnv: 'test' } as AppConfig,
        {
          ping: vi.fn(async () => {
            throw new Error('catastrophic');
          }),
        } as unknown as PrismaService,
        { ping: vi.fn(async () => ok(true)) } as unknown as RedisService,
        { getHealth: vi.fn(async () => null) } as unknown as AiService,
      );

      const report = await service.getReadiness();

      expect(report.status).toBe('down');
      expect(dependency(report, 'database').message).toBe('catastrophic');
    });
  });
});
