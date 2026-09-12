import { Injectable } from '@nestjs/common';
import type { DependencyHealth, HealthReport, HealthStatus } from '@samadhaan/shared';
import { AiService } from '../ai/ai.service.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const SERVICE_NAME = 'samadhaan-api';
const SERVICE_VERSION = '0.1.0';

/** Severity order used to reduce dependency statuses to an overall status. */
const SEVERITY: Record<HealthStatus, number> = { ok: 0, degraded: 1, down: 2 };

/** Outcome of a single probe: a status, or the error that ended it. */
type ProbeOutcome = { status: HealthStatus; message?: string } | Error;

/**
 * How far a failing dependency can drag the overall status down.
 *
 * The API can still serve reads without Redis, and everything except AI
 * features without the AI service, so neither can make the system `down`.
 * Without PostgreSQL nothing works.
 */
const MAX_IMPACT: Record<string, HealthStatus> = {
  database: 'down',
  redis: 'degraded',
  aiService: 'degraded',
};

@Injectable()
export class HealthService {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ai: AiService,
  ) {}

  /** Liveness: is the process itself up? Does not touch dependencies. */
  getLiveness(): Pick<HealthReport, 'status' | 'service' | 'version' | 'timestamp'> {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness: probes every dependency in parallel and always returns a report.
   * A failing dependency is reported, never thrown — an operator needs to see
   * *which* dependency is broken, and the API must stay observable meanwhile.
   */
  async getReadiness(requestId?: string): Promise<HealthReport> {
    const dependencies = await Promise.all([
      this.probe('database', async () => {
        const result = await this.prisma.ping();
        return result.ok ? { status: 'ok' as const } : result.error;
      }),
      this.probe('redis', async () => {
        const result = await this.redis.ping();
        return result.ok ? { status: 'ok' as const } : result.error;
      }),
      this.probe('aiService', async () => {
        const report = await this.ai.getHealth(requestId);
        if (report === null) return new Error('AI service is unreachable');

        // The AI service knows its own dependencies (model providers, model
        // availability). Pass its verdict through rather than flattening it:
        // a reachable service with unconfigured providers is degraded, not down.
        return {
          status: report.status,
          message: report.status === 'ok' ? undefined : this.summariseUnhealthy(report),
        };
      }),
    ]);

    return {
      status: this.aggregate(dependencies),
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      environment: this.config.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }

  /** Names the AI service's own failing dependencies, so the cause is visible. */
  private summariseUnhealthy(report: HealthReport): string {
    const failing = report.dependencies
      .filter((dependency) => dependency.status !== 'ok')
      .map((dependency) => dependency.name);

    return failing.length > 0
      ? `AI service is ${report.status}: ${failing.join(', ')}`
      : `AI service is ${report.status}`;
  }

  /**
   * Runs one probe, timing it and converting any outcome — including an
   * unexpected throw — into a `DependencyHealth` entry.
   */
  private async probe(
    name: string,
    check: () => Promise<ProbeOutcome>,
  ): Promise<DependencyHealth> {
    const startedAt = performance.now();

    try {
      const outcome = await check();
      const latencyMs = Math.round(performance.now() - startedAt);

      return outcome instanceof Error
        ? { name, status: 'down', latencyMs, message: outcome.message }
        : {
            name,
            status: outcome.status,
            latencyMs,
            ...(outcome.message ? { message: outcome.message } : {}),
          };
    } catch (error) {
      return {
        name,
        status: 'down',
        latencyMs: Math.round(performance.now() - startedAt),
        message: error instanceof Error ? error.message : 'Probe failed',
      };
    }
  }

  /** Worst status across dependencies, capped by each one's maximum impact. */
  private aggregate(dependencies: DependencyHealth[]): HealthStatus {
    return dependencies.reduce<HealthStatus>((worst, dependency) => {
      if (dependency.status === 'ok') return worst;

      const cap = MAX_IMPACT[dependency.name] ?? 'degraded';
      const effective =
        SEVERITY[dependency.status] < SEVERITY[cap] ? dependency.status : cap;

      return SEVERITY[effective] > SEVERITY[worst] ? effective : worst;
    }, 'ok');
  }
}
