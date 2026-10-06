import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { CoordinatorContextService } from './coordinator-context.service.js';
import { CoordinatorService } from './coordinator.service.js';

const LOCK_KEY = 'coordinator:sweep-lock';

/**
 * The background coordinator check (Prompt 19).
 *
 * Every `COORDINATOR_SCHEDULE_MINUTES` (default two hours), up to
 * `COORDINATOR_BATCH_SIZE` live projects are re-analysed — only those whose
 * insight is missing, expired or out of date with the project, and never more
 * often than `COORDINATOR_MIN_INTERVAL_HOURS` per project. A Redis lock keeps
 * two API instances from sweeping at once. Off in tests.
 */
@Injectable()
export class CoordinatorSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CoordinatorSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: CoordinatorService,
    private readonly context: CoordinatorContextService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    const settings = this.config.coordinator;
    if (!settings.scheduleEnabled || settings.batchSize === 0) return;
    this.timer = setInterval(() => void this.sweep(), settings.scheduleMinutes * 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public for tests and operations. Returns the projects analysed. */
  async sweep(now: Date = new Date()): Promise<number> {
    const settings = this.config.coordinator;
    if (!settings.enabled) return 0;
    const lock = await this.redis.connection
      .set(LOCK_KEY, '1', 'EX', 30 * 60, 'NX')
      .catch(() => 'OK');
    if (lock !== 'OK') return 0;

    try {
      const cutoff = new Date(now.getTime() - settings.minIntervalHours * 3_600_000);
      const projects = await this.prisma.resolutionProject.findMany({
        where: {
          status: { in: ['PLANNED', 'ACTIVE'] },
          room: { status: 'OPEN' },
          // Nothing tried since the cut-off.
          insights: { none: { generatedAt: { gte: cutoff } } },
        },
        orderBy: { updatedAt: 'desc' },
        take: settings.batchSize * 3,
      });

      let analysed = 0;
      for (const project of projects) {
        if (analysed >= settings.batchSize) break;
        const latest = await this.prisma.projectAIInsight.findFirst({
          where: { projectId: project.id, status: 'COMPLETED' },
          orderBy: { generatedAt: 'desc' },
          select: { basedOnChangeAt: true, expiresAt: true },
        });
        if (latest && latest.expiresAt > now) {
          const { lastChangeAt } = await this.context.health(project);
          if (lastChangeAt <= latest.basedOnChangeAt) continue; // still current
        }
        await this.coordinator.analyse(project, null, 'SCHEDULED');
        analysed += 1;
      }
      return analysed;
    } catch (error) {
      this.logger.warn(
        `Coordinator sweep failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return 0;
    } finally {
      await this.redis.connection.del(LOCK_KEY).catch(() => undefined);
    }
  }
}
