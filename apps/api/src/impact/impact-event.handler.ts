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
import { RedisService } from '../redis/redis.service.js';
import { ContributionAttributionService } from './contribution-attribution.service.js';
import { ReputationService } from './reputation.service.js';

const LOCK_KEY = 'impact:reconcile-lock';

/**
 * Decides **when** impact is awarded (Prompt 23) — only on confirmed outcomes:
 *
 *   PROBLEM_STATUS_CHANGED → VERIFIED   verified-report reward (+ waiting duplicates)
 *   PROBLEM_STATUS_CHANGED → DUPLICATE  duplicate-identification reward, if the original is verified
 *   PROBLEM_STATUS_CHANGED → RESOLVED   contribution attribution
 *   PROBLEM_STATUS_CHANGED → REJECTED   reporter's reputation recomputed (no points either way)
 *   VERIFICATION_DECIDED (rejected)     submitters' reputation recomputed
 *
 * The event bus is in-process (an event in flight during a crash is lost), so
 * a bounded **reconciliation sweep** — on start-up and every
 * `IMPACT_RECONCILE_MINUTES` — awards anything a verified or resolved problem
 * should have produced. Every award is idempotent, so the sweep can never
 * award twice.
 */
@Injectable()
export class ImpactEventHandler
  implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap
{
  private readonly logger = new Logger(ImpactEventHandler.name);
  private unsubscribe: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly inFlight = new Set<Promise<unknown>>();
  private active: boolean;

  constructor(
    private readonly bus: DomainEventBus,
    private readonly attribution: ContributionAttributionService,
    private readonly reputation: ReputationService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {
    this.active = config.impact.enabled;
  }

  /** Turns awarding on for this app instance (the impact test suite). */
  activate(): void {
    this.active = true;
  }

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribe((event) => this.handle(event));
    const minutes = this.config.impact.reconcileMinutes;
    if (minutes > 0) {
      this.timer = setInterval(() => void this.reconcile(), minutes * 60_000);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.timer) clearInterval(this.timer);
  }

  onApplicationBootstrap(): void {
    if (!this.config.impact.reconcileOnStartup) return;
    setTimeout(() => void this.reconcile(), 10_000).unref();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!this.active) return;
    const run = async () => {
      if (event.type === 'PROBLEM_STATUS_CHANGED') {
        if (event.toStatus === 'VERIFIED')
          await this.attribution.onVerified(event.problemId);
        else if (event.toStatus === 'DUPLICATE')
          await this.attribution.onDuplicateConfirmed(event.problemId);
        else if (event.toStatus === 'RESOLVED')
          await this.attribution.onResolved(event.problemId);
        else if (event.toStatus === 'REJECTED')
          await this.reputation.recompute(event.reporterId);
      } else if (event.type === 'VERIFICATION_DECIDED' && event.decision === 'REJECTED') {
        for (const userId of event.submitterIds) await this.reputation.recompute(userId);
      }
    };
    const job = run().catch((error: unknown) =>
      this.logger.warn(
        `Impact handling failed for ${event.type}: ${error instanceof Error ? error.message : 'unknown'}`,
      ),
    );
    this.inFlight.add(job);
    await job;
    this.inFlight.delete(job);
  }

  /** Resolves when no award is in progress. For tests. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all(this.inFlight);
  }

  /** Awards what verified and resolved problems should already have produced. Bounded. */
  async reconcile(): Promise<number> {
    if (!this.active) return 0;
    const lock = await this.redis.connection
      .set(LOCK_KEY, '1', 'EX', 15 * 60, 'NX')
      .catch(() => 'OK');
    if (lock !== 'OK') return 0;
    try {
      const limit = this.config.impact.reconcileBatch;
      const verified = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT p.id FROM problems p
        WHERE p."deletedAt" IS NULL AND p.status::text IN ('VERIFIED', 'IN_PROGRESS', 'RESOLVED')
          AND NOT EXISTS (
            SELECT 1 FROM impact_point_transactions t
            WHERE t."idempotencyKey" = 'PROBLEM_VERIFIED:' || p.id || ':' || p."reporterId")
        ORDER BY p."createdAt" ASC LIMIT ${limit}
      `;
      for (const { id } of verified) await this.attribution.onVerified(id);
      const resolved = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT p.id FROM problems p
        WHERE p."deletedAt" IS NULL AND p.status = 'RESOLVED'
          AND NOT EXISTS (
            SELECT 1 FROM impact_point_transactions t
            WHERE t."idempotencyKey" = 'PROBLEM_RESOLVED:' || p.id || ':' || p."reporterId" || ':reporter')
        ORDER BY p."resolvedAt" ASC NULLS LAST LIMIT ${limit}
      `;
      for (const { id } of resolved) await this.attribution.onResolved(id);
      const total = verified.length + resolved.length;
      if (total > 0)
        this.logger.log(`Impact reconciliation processed ${total} problem(s)`);
      return total;
    } catch (error) {
      this.logger.warn(
        `Impact reconciliation failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return 0;
    } finally {
      await this.redis.connection.del(LOCK_KEY).catch(() => undefined);
    }
  }
}
