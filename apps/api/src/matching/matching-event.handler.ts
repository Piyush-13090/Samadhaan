import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AppConfig } from '../config/app.config.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import type { DomainEvent } from '../events/domain-events.js';
import { OrganizationEmbeddingService } from './organization-embedding.service.js';
import { OrganizationMatchingService } from './organization-matching.service.js';

/** Edits made in one sitting — a description, then three expertise rows — refresh once. */
const ORGANIZATION_DEBOUNCE_MS = 2_000;

/**
 * Decides **when** matching runs. The rule is: only when an input changed.
 *
 *  - A problem's AI analysis finished (or failed — the reporter's category
 *    still matches): match that problem.
 *  - An organisation's profile, expertise or location changed: re-embed it
 *    (only if the profile text actually changed), mark its matches stale and
 *    re-match the problems it could plausibly affect.
 *  - On boot: embed organisations that have no embedding, and re-match
 *    problems left stale or never matched. Bounded by MATCHING_SWEEP_LIMIT.
 *
 * Opening a page never triggers matching.
 */
@Injectable()
export class MatchingEventHandler
  implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap
{
  private readonly logger = new Logger(MatchingEventHandler.name);
  private unsubscribe: (() => void) | null = null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly bus: DomainEventBus,
    private readonly config: AppConfig,
    private readonly embeddings: OrganizationEmbeddingService,
    private readonly matching: OrganizationMatchingService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribe((event) => this.handle(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  onApplicationBootstrap(): void {
    const settings = this.config.matching;
    if (!settings.enabled || !settings.sweepOnStartup) return;
    // After start-up, so the API is serving before any model is loaded.
    setTimeout(() => void this.sweep(settings.sweepLimit), 5_000).unref();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!this.config.matching.enabled) return;

    if (event.type === 'AI_ANALYSIS_COMPLETED' || event.type === 'AI_ANALYSIS_FAILED') {
      this.matching.enqueue(event.problemId, 'analysis');
      return;
    }

    // A review decision can end a problem's eligibility (rejected, duplicate);
    // re-running drops its recommendations. Verification keeps them.
    if (event.type === 'PROBLEM_STATUS_CHANGED') {
      this.matching.enqueue(event.problemId, 'status-change');
      return;
    }

    if (event.type === 'ORGANIZATION_PROFILE_CHANGED') {
      const existing = this.timers.get(event.organizationId);
      if (existing) clearTimeout(existing);
      this.timers.set(
        event.organizationId,
        setTimeout(() => {
          this.timers.delete(event.organizationId);
          this.track(this.refreshOrganization(event.organizationId));
        }, ORGANIZATION_DEBOUNCE_MS),
      );
    }
  }

  /**
   * Runs pending organisation refreshes now and waits for them. Tests use it
   * instead of sleeping through the debounce.
   */
  async flush(): Promise<void> {
    for (const [organizationId, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(organizationId);
      this.track(this.refreshOrganization(organizationId));
    }
    await Promise.all(this.inFlight);
  }

  private track(work: Promise<unknown>): void {
    this.inFlight.add(work);
    void work.finally(() => this.inFlight.delete(work));
  }

  private async refreshOrganization(organizationId: string): Promise<void> {
    try {
      const embedding = await this.embeddings.refresh(organizationId);
      const queued = await this.matching.organizationChanged(organizationId);
      this.logger.log(
        `Organisation ${organizationId} changed: embedding ${embedding}, ${queued} problem(s) queued`,
      );
    } catch (error) {
      this.logger.error(
        `Could not refresh matches for organisation ${organizationId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async sweep(limit: number): Promise<void> {
    try {
      const embedded = await this.embeddings.backfill(limit);
      const problems = await this.matching.problemsNeedingMatches(limit);
      for (const id of problems) this.matching.enqueue(id, 'sweep');
      this.logger.log(
        `Matching sweep: ${embedded} organisation(s) embedded, ${problems.length} problem(s) queued`,
      );
    } catch (error) {
      this.logger.error(
        `Matching sweep failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
