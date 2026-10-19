import { MetricsService } from '../metrics/metrics.service.js';
import { withRedisLock } from '../common/redis-lock.js';
import {
  Injectable,
  Optional,
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
    @Optional() private readonly metrics?: MetricsService,
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
    let failed = false;
    const outcome = await withRedisLock(
      this.redis.connection,
      LOCK_KEY,
      15 * 60,
      'run',
      async () => {
        try {
          const limit = this.config.impact.reconcileBatch;
          const verified = await this.page(
            'verified',
            limit,
            (after) =>
              this.prisma.$queryRaw<Array<{ id: string; at: Date }>>`
              SELECT p.id, p."createdAt" AS at FROM problems p
              WHERE p."deletedAt" IS NULL AND p.status::text IN ('VERIFIED', 'IN_PROGRESS', 'RESOLVED')
                AND (p."createdAt", p.id::text) > (${after.at}, ${after.id})
                AND NOT EXISTS (
                  SELECT 1 FROM impact_point_transactions t
                  WHERE t."idempotencyKey" = 'PROBLEM_VERIFIED:' || p.id || ':' || p."reporterId")
              ORDER BY p."createdAt" ASC, p.id ASC LIMIT ${limit}
            `,
          );
          for (const { id } of verified) await this.attribution.onVerified(id);
          const resolved = await this.page(
            'resolved',
            limit,
            (after) =>
              this.prisma.$queryRaw<Array<{ id: string; at: Date }>>`
              SELECT p.id, p."createdAt" AS at FROM problems p
              WHERE p."deletedAt" IS NULL AND p.status = 'RESOLVED'
                AND (p."createdAt", p.id::text) > (${after.at}, ${after.id})
                AND NOT EXISTS (
                  SELECT 1 FROM impact_point_transactions t
                  WHERE t."idempotencyKey" = 'PROBLEM_RESOLVED:' || p.id || ':' || p."reporterId" || ':reporter')
              ORDER BY p."createdAt" ASC, p.id ASC LIMIT ${limit}
            `,
          );
          for (const { id } of resolved) await this.attribution.onResolved(id);
          const total = verified.length + resolved.length;
          if (total > 0)
            this.logger.log(`Impact reconciliation processed ${total} problem(s)`);
          return total;
        } catch (error) {
          failed = true;
          this.logger.warn(
            `Impact reconciliation failed: ${error instanceof Error ? error.message : 'unknown'}`,
          );
          return 0;
        }
      },
    );
    this.metrics?.jobRuns.inc({
      job: 'impact_reconcile',
      outcome: outcome.ran
        ? failed
          ? 'failed'
          : 'completed'
        : outcome.reason === 'held'
          ? 'skipped_held'
          : 'skipped_redis_error',
    });
    return outcome.ran ? outcome.value : 0;
  }

  /**
   * One page of a reconciliation scan, resuming after where the last run
   * stopped (Prompt 29). Always restarting from the oldest rows starved the
   * scan: problems whose award is capped write no ledger row, so they were
   * selected again every run and newer problems were never reached. The cursor
   * lives in Redis; when it is lost, or a page comes back short, the scan
   * wraps to the start, so every candidate is eventually revisited.
   */
  private async page(
    scan: 'verified' | 'resolved',
    limit: number,
    query: (after: { at: Date; id: string }) => Promise<Array<{ id: string; at: Date }>>,
  ): Promise<Array<{ id: string }>> {
    const key = `impact:reconcile:cursor:${scan}`;
    const start = { at: new Date(0), id: '' };
    const raw = await this.redis.connection.get(key).catch(() => null);
    let after = start;
    if (raw) {
      const [at, id] = raw.split('|');
      const date = new Date(at ?? '');
      if (!Number.isNaN(date.getTime()) && id !== undefined) after = { at: date, id };
    }
    let rows = await query(after);
    if (rows.length === 0 && after !== start) rows = await query(start);
    const last = rows.at(-1);
    const next =
      rows.length < limit || !last ? null : `${last.at.toISOString()}|${last.id}`;
    await (
      next
        ? this.redis.connection.set(key, next, 'EX', 7 * 86_400)
        : this.redis.connection.del(key)
    ).catch(() => undefined);
    return rows;
  }
}
