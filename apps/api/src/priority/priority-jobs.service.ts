import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import type { DomainEvent } from '../events/domain-events.js';
import { Prisma } from '../generated/prisma/client.js';
import { RedisService } from '../redis/redis.service.js';
import { FEATURE_VERSION, SCORING_VERSION } from './priority-model.js';
import { ASSESSABLE_STATUSES } from './priority-feature.service.js';
import { PriorityCalculationService } from './priority-calculation.service.js';

const LOCK_KEY = 'priority:sweep-lock';
/** Inputs that change the problem itself are recalculated almost at once. */
const PROMPT_DELAY_MS = 1_000;

/**
 * Decides **when** priority is recalculated (Prompt 21). Never on a page
 * request.
 *
 * - The AI analysis finished, the review status changed, a duplicate was
 *   found or confirmed, a project started or changed: recalculate soon.
 * - Support, follows and comments: coalesced per problem over
 *   `PRIORITY_DEBOUNCE_SECONDS`, so a burst of activity is one job.
 * - Periodically (recency decays) and on start-up (missing, stale, or from an
 *   older scoring version): a bounded batch.
 *
 * Jobs are idempotent: one queued job per problem, one calculation at a time
 * (and a per-problem database lock across instances), and a recalculation that
 * changes nothing only confirms the latest assessment. AI features are reused
 * while their inputs are unchanged, so engagement-driven jobs make no AI call.
 */
@Injectable()
export class PriorityJobsService
  implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap
{
  private readonly logger = new Logger(PriorityJobsService.name);
  private unsubscribe: (() => void) | null = null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pending = new Map<string, string>();
  private readonly queue: string[] = [];
  private running: Promise<void> | null = null;
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly bus: DomainEventBus,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly calculation: PriorityCalculationService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribe((event) => this.handle(event));
    const minutes = this.config.priority.scheduleMinutes;
    if (minutes > 0) {
      this.interval = setInterval(() => void this.sweep('scheduled'), minutes * 60_000);
      this.interval.unref();
    }
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.interval) clearInterval(this.interval);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  onApplicationBootstrap(): void {
    if (!this.config.priority.sweepOnStartup) return;
    setTimeout(() => void this.sweep('startup'), 8_000).unref();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!this.config.priority.enabled) return;
    const debounce = this.config.priority.debounceMs;
    switch (event.type) {
      case 'AI_ANALYSIS_COMPLETED':
      case 'AI_ANALYSIS_FAILED':
        return this.schedule(event.problemId, 'analysis', PROMPT_DELAY_MS);
      case 'PROBLEM_STATUS_CHANGED': {
        this.schedule(event.problemId, 'status', PROMPT_DELAY_MS);
        // A confirmed duplicate adds to the original's cluster.
        if (event.toStatus === 'DUPLICATE') {
          const row = await this.prisma.problem.findUnique({
            where: { id: event.problemId },
            select: { duplicateOfId: true },
          });
          if (row?.duplicateOfId)
            this.schedule(row.duplicateOfId, 'cluster', PROMPT_DELAY_MS);
        }
        return;
      }
      case 'LIKELY_DUPLICATES_FOUND':
        this.schedule(event.problemId, 'cluster', debounce);
        for (const match of event.matches) {
          this.schedule(match.candidateProblemId, 'cluster', debounce);
        }
        return;
      case 'PROBLEM_SUPPORTED':
      case 'PROBLEM_FOLLOWED':
      case 'COMMENT_CREATED':
      case 'COMMENT_REPLIED':
        return this.schedule(event.problemId, 'engagement', debounce);
      // Resolution context is shown beside the score, never scored.
      case 'ALLOCATION_ACCEPTED':
        return this.schedule(event.problemId, 'resolution', debounce);
      case 'PROJECT_STATUS_CHANGED': {
        const problem = await this.prisma.problem.findUnique({
          where: { publicId: event.problemPublicId },
          select: { id: true },
        });
        if (problem) this.schedule(problem.id, 'resolution', debounce);
        return;
      }
      default:
        return;
    }
  }

  /** Coalesces: a problem already waiting keeps one timer and one job. */
  schedule(problemId: string, trigger: string, delayMs: number): void {
    const existing = this.timers.get(problemId);
    if (existing) clearTimeout(existing);
    this.pending.set(problemId, trigger);
    this.timers.set(
      problemId,
      setTimeout(() => {
        this.timers.delete(problemId);
        this.enqueue(problemId);
      }, delayMs),
    );
  }

  /** Runs every waiting job now. For tests and operations. */
  flush(): void {
    for (const [problemId, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(problemId);
      this.enqueue(problemId);
    }
  }

  /** Resolves when nothing is waiting or running. */
  async idle(): Promise<void> {
    this.flush();
    while (this.running) await this.running;
  }

  private enqueue(problemId: string): void {
    if (!this.queue.includes(problemId)) this.queue.push(problemId);
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const problemId = this.queue.shift()!;
      const trigger = this.pending.get(problemId) ?? 'event';
      this.pending.delete(problemId);
      await this.calculation.calculate(problemId, trigger).catch((error: unknown) => {
        this.logger.warn(
          `Priority calculation failed for ${problemId}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
    }
  }

  /**
   * A bounded batch of problems whose assessment is missing, older than
   * `PRIORITY_REFRESH_HOURS`, or from another scoring version. A Redis lock
   * keeps two instances from sweeping at once.
   */
  async sweep(trigger: string, now: Date = new Date()): Promise<number> {
    const settings = this.config.priority;
    if (!settings.enabled || settings.batchSize === 0) return 0;
    const lock = await this.redis.connection
      .set(LOCK_KEY, '1', 'EX', 15 * 60, 'NX')
      .catch(() => 'OK');
    if (lock !== 'OK') return 0;
    try {
      const cutoff = new Date(now.getTime() - settings.refreshHours * 3_600_000);
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT p.id FROM problems p
        LEFT JOIN LATERAL (
          SELECT a."scoringVersion", a."featureVersion" FROM problem_priority_assessments a
          WHERE a."problemId" = p.id ORDER BY a."calculatedAt" DESC LIMIT 1
        ) latest ON true
        WHERE p."deletedAt" IS NULL
          AND p.status::text = ANY (${[...ASSESSABLE_STATUSES]}::text[])
          AND (p."priorityAssessedAt" IS NULL OR p."priorityAssessedAt" < ${cutoff}
               OR latest."scoringVersion" IS DISTINCT FROM ${SCORING_VERSION}
               OR latest."featureVersion" IS DISTINCT FROM ${FEATURE_VERSION})
        ORDER BY p."priorityAssessedAt" ASC NULLS FIRST
        LIMIT ${settings.batchSize}
      `);
      for (const { id } of rows) {
        this.pending.set(id, trigger);
        this.enqueue(id);
      }
      if (rows.length > 0)
        this.logger.log(`Priority ${trigger} sweep queued ${rows.length} problem(s)`);
      await this.idle();
      return rows.length;
    } catch (error) {
      this.logger.warn(
        `Priority sweep failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return 0;
    } finally {
      await this.redis.connection.del(LOCK_KEY).catch(() => undefined);
    }
  }
}
