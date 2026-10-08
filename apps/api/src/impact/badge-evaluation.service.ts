import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { BadgeView, ImpactTransactionType, ReputationTier } from '@samadhaan/shared';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import { BADGES, earnedBadges } from './impact-rules.js';

/**
 * Badges (Prompt 23). Definitions live in code and are upserted on start-up;
 * awards are made only here, after the user's own counts change — one grouped
 * query for that user, never a scan of everyone. `UNIQUE (userId, badgeKey)`
 * makes awarding idempotent; no endpoint can grant one.
 */
@Injectable()
export class BadgeEvaluationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BadgeEvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.syncDefinitions().catch((error: unknown) =>
      this.logger.warn(
        `Badge definitions not synced: ${error instanceof Error ? error.message : 'unknown'}`,
      ),
    );
  }

  async syncDefinitions(): Promise<void> {
    for (const [i, badge] of BADGES.entries()) {
      await this.prisma.badgeDefinition.upsert({
        where: { key: badge.key },
        create: {
          key: badge.key,
          name: badge.name,
          description: badge.description,
          criteria: badge.criteria,
          sortOrder: i,
        },
        update: {
          name: badge.name,
          description: badge.description,
          criteria: badge.criteria,
          sortOrder: i,
          active: true,
        },
      });
    }
  }

  async evaluate(userId: string): Promise<string[]> {
    const [grouped, stats, owned] = await Promise.all([
      this.prisma.impactPointTransaction.groupBy({
        by: ['type'],
        where: { userId, amount: { gt: 0 } },
        _count: { _all: true },
      }),
      this.prisma.userImpactStats.findUnique({ where: { userId } }),
      this.prisma.userBadge.findMany({ where: { userId }, select: { badgeKey: true } }),
    ]);
    const counts = Object.fromEntries(
      grouped.map((g) => [g.type, g._count._all]),
    ) as Partial<Record<ImpactTransactionType, number>>;
    const input = {
      counts,
      impactPoints: stats?.impactPoints ?? 0,
      resolvedContributions: stats?.resolvedContributions ?? 0,
      tier: (stats?.reputationTier ?? 'NEW_CONTRIBUTOR') as ReputationTier,
    };
    const have = new Set(owned.map((o) => o.badgeKey));
    const awarded: string[] = [];
    for (const key of earnedBadges(input).filter((k) => !have.has(k))) {
      const result = await this.prisma.userBadge.createMany({
        data: [
          {
            userId,
            badgeKey: key,
            evidence: {
              counts,
              impactPoints: input.impactPoints,
              resolvedContributions: input.resolvedContributions,
            },
          },
        ],
        skipDuplicates: true,
      });
      if (result.count === 1) {
        awarded.push(key);
        const badge = BADGES.find((b) => b.key === key)!;
        this.events.publish({
          type: 'BADGE_EARNED',
          userId,
          badgeKey: key,
          badgeName: badge.name,
        });
      }
    }
    return awarded;
  }

  async view(userId: string): Promise<BadgeView[]> {
    const [definitions, owned] = await Promise.all([
      this.prisma.badgeDefinition.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.userBadge.findMany({ where: { userId } }),
    ]);
    const byKey = new Map(owned.map((o) => [o.badgeKey, o]));
    return definitions.map((d) => ({
      key: d.key,
      name: d.name,
      description: d.description,
      criteria: d.criteria,
      earned: byKey.has(d.key),
      awardedAt: byKey.get(d.key)?.awardedAt.toISOString() ?? null,
    }));
  }
}
