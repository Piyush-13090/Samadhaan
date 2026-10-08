import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { VerificationAnalysisService } from './verification-analysis.service.js';

/**
 * Runs evidence AI reviews in the background (Prompt 22): an upload or a
 * submission returns at once, and the model call never holds a request open.
 *
 * - **Idempotent:** a job claims its evidence with a conditional update
 *   (aiStatus PENDING → PROCESSING); a second job for the same evidence finds
 *   nothing to claim. One evidence item is queued at most once.
 * - **Retryable and bounded:** a retryable failure re-queues after
 *   `VERIFICATION_RETRY_SECONDS`, up to `VERIFICATION_MAX_ATTEMPTS`; then the
 *   review is recorded as FAILED and the evidence moves on.
 * - **Observable:** every outcome is logged and visible as the evidence's
 *   `aiStatus`; on start-up, reviews left pending or interrupted are resumed.
 */
@Injectable()
export class VerificationJobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VerificationJobsService.name);
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private running: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysis: VerificationAnalysisService,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.verification.sweepOnStartup) return;
    // An interrupted review (PROCESSING at shutdown) is pending again.
    await this.prisma.resolutionEvidence
      .updateMany({ where: { aiStatus: 'PROCESSING' }, data: { aiStatus: 'PENDING' } })
      .catch(() => undefined);
    await this.prisma.resolutionEvidence
      .updateMany({ where: { status: 'PROCESSING' }, data: { status: 'SUBMITTED' } })
      .catch(() => undefined);
    const pending = await this.prisma.resolutionEvidence
      .findMany({ where: { aiStatus: 'PENDING' }, select: { id: true }, take: 200 })
      .catch(() => []);
    for (const { id } of pending) this.enqueue(id);
    if (pending.length) this.logger.log(`Resumed ${pending.length} evidence review(s)`);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  enqueue(evidenceId: string): void {
    if (this.queued.has(evidenceId)) return;
    this.queued.add(evidenceId);
    this.queue.push(evidenceId);
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
  }

  /** Resolves when nothing is queued, running or waiting to retry. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.running || this.timers.size > 0) {
      if (this.running) await this.running;
      else await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.queued.delete(id);
      let result: 'done' | 'retry' | 'skipped';
      try {
        result = await this.analysis.run(id);
      } catch (error) {
        this.logger.error(
          `Evidence review crashed for ${id}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        result = await this.analysis.recover(id).catch(() => 'skipped' as const);
      }
      if (result === 'retry') this.retry(id);
    }
  }

  private retry(id: string): void {
    const delay = this.config.verification.retryMs;
    if (delay === 0) {
      this.enqueue(id);
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.enqueue(id);
    }, delay);
    timer.unref();
    this.timers.add(timer);
  }
}
