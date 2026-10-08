import { Injectable } from '@nestjs/common';
import type { ReputationTier, ReputationView } from '@samadhaan/shared';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import {
  REPUTATION_VERSION,
  TIERS,
  nextTier,
  reputationScore,
  tierFor,
  tierIndex,
  type ReputationSignals,
} from './impact-rules.js';

const VERIFIED = ['VERIFIED', 'IN_PROGRESS', 'RESOLVED'];

/**
 * Reputation (Prompt 23): an initial heuristic of contribution quality,
 * 0–100, separate from impact points. Recomputed from bounded per-user counts
 * after an award or a relevant decision — never a scan of everyone.
 */
@Injectable()
export class ReputationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
  ) {}

  async signals(userId: string): Promise<ReputationSignals> {
    const since = new Date(Date.now() - 365 * 86_400_000);
    const [reports, evidence, stats, months] = await Promise.all([
      this.prisma.problem.groupBy({
        by: ['status'],
        where: {
          reporterId: userId,
          deletedAt: null,
          status: { in: [...VERIFIED, 'REJECTED'] as never },
        },
        _count: { _all: true },
      }),
      this.prisma.resolutionEvidence.groupBy({
        by: ['status'],
        where: { submittedById: userId, status: { in: ['APPROVED', 'REJECTED'] } },
        _count: { _all: true },
      }),
      this.prisma.userImpactStats.findUnique({ where: { userId } }),
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(DISTINCT date_trunc('month', "createdAt"))::int AS n
        FROM impact_point_transactions
        WHERE "userId" = ${userId}::uuid AND "createdAt" >= ${since} AND amount > 0
          AND type <> 'ADMIN_ADJUSTMENT'
      `,
    ]);
    const count = (
      rows: Array<{ status: string; _count: { _all: number } }>,
      statuses: string[],
    ) =>
      rows
        .filter((r) => statuses.includes(r.status))
        .reduce((sum, r) => sum + r._count._all, 0);
    return {
      verifiedReports: count(reports, VERIFIED),
      rejectedReports: count(reports, ['REJECTED']),
      approvedEvidence: count(evidence, ['APPROVED']),
      rejectedEvidence: count(evidence, ['REJECTED']),
      resolvedContributions: stats?.resolvedContributions ?? 0,
      activeMonths: months[0]?.n ?? 0,
    };
  }

  /** Recomputes score and tier; announces a tier reached for the first time. */
  async recompute(userId: string): Promise<{ score: number; tier: ReputationTier }> {
    const signals = await this.signals(userId);
    const score = reputationScore(signals);
    const current = await this.prisma.userImpactStats.findUnique({ where: { userId } });
    const tier = tierFor(current?.impactPoints ?? 0, score);
    await this.prisma.userImpactStats.upsert({
      where: { userId },
      create: {
        userId,
        reputationScore: score,
        reputationTier: tier,
        reputationVersion: REPUTATION_VERSION,
        reputationUpdatedAt: new Date(),
      },
      update: {
        reputationScore: score,
        reputationTier: tier,
        reputationVersion: REPUTATION_VERSION,
        reputationUpdatedAt: new Date(),
      },
    });
    const before = (current?.reputationTier ?? 'NEW_CONTRIBUTOR') as ReputationTier;
    // Moving up is worth telling; a tier never announced twice (notification de-duplication).
    if (tierIndex(tier) > tierIndex(before)) {
      this.events.publish({ type: 'REPUTATION_TIER_REACHED', userId, tier });
    }
    return { score, tier };
  }

  async view(userId: string): Promise<ReputationView> {
    const [stats, signals, successful] = await Promise.all([
      this.prisma.userImpactStats.findUnique({ where: { userId } }),
      this.signals(userId),
      this.prisma.impactPointTransaction.count({
        where: {
          userId,
          amount: { gt: 0 },
          type: { notIn: ['ADMIN_ADJUSTMENT', 'PENALTY'] },
        },
      }),
    ]);
    const points = stats?.impactPoints ?? 0;
    const score = stats ? Number(stats.reputationScore) : reputationScore(signals);
    const tier =
      (stats?.reputationTier as ReputationTier | undefined) ?? tierFor(points, score);
    const next = nextTier(tier);
    return {
      score: Math.round(score),
      tier,
      next: next
        ? {
            tier: next.tier,
            pointsNeeded: Math.max(0, next.minPoints - points),
            minimumReputation: next.minReputation,
          }
        : null,
      impactPoints: points,
      // Public, positive signals only — rejections and other negatives are never shown.
      verifiedReports: signals.verifiedReports,
      successfulContributions: successful,
      resolvedContributions: stats?.resolvedContributions ?? 0,
      updatedAt: stats?.reputationUpdatedAt?.toISOString() ?? null,
      note: 'An initial heuristic of contribution quality — not a validated measure of trustworthiness.',
    };
  }
}

export { TIERS };
