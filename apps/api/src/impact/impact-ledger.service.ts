import { Injectable, Logger } from '@nestjs/common';
import type { ImpactTransactionType } from '@samadhaan/shared';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import { Prisma } from '../generated/prisma/client.js';
import { BadgeEvaluationService } from './badge-evaluation.service.js';
import { CAP_GROUPS, CURRENT_RULES, RESOLUTION_TYPES } from './impact-rules.js';
import { ReputationService } from './reputation.service.js';

/** One award to make. The ledger decides whether it happens. */
export interface AwardDraft {
  userId: string;
  type: ImpactTransactionType;
  amount: number;
  reason: string;
  entityType: string | null;
  entityId: string | null;
  problemId: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  actorUserId?: string | null;
}

export interface AwardResult {
  created: number;
  /** Per user: the points actually added. */
  byUser: Map<string, number>;
}

/**
 * The only writer of impact points (Prompt 23).
 *
 * Each award is an `INSERT … ON CONFLICT ("idempotencyKey") DO NOTHING` inside
 * a transaction holding a per-user advisory lock:
 *
 * - **Idempotent:** the unique key means a replayed, retried or concurrent
 *   event inserts nothing the second time — enforced by the database, not by
 *   an application check.
 * - **Capped:** rolling 30-day caps are counted under the same lock, so two
 *   concurrent awards cannot both slip under a cap.
 * - **Consistent:** the user's aggregate (`user_impact_stats`) changes in the
 *   same transaction, and only when a row was actually inserted.
 *
 * After commit it refreshes reputation and badges for the users affected and
 * publishes one notification-worthy event per user per call.
 */
@Injectable()
export class ImpactLedgerService {
  private readonly logger = new Logger(ImpactLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reputation: ReputationService,
    private readonly badges: BadgeEvaluationService,
    private readonly events: DomainEventBus,
  ) {}

  async award(
    drafts: AwardDraft[],
    notice?: { headline: string; problemPublicId: string | null; eventKey: string },
  ): Promise<AwardResult> {
    const byUser = new Map<string, number>();
    let created = 0;
    const users = [...new Set(drafts.filter((d) => d.amount !== 0).map((d) => d.userId))];

    for (const userId of users) {
      const mine = drafts.filter((d) => d.userId === userId && d.amount !== 0);
      const added = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`impact:${userId}`}))`;
        let total = 0;
        let rows = 0;
        for (const draft of mine) {
          if (!(await this.underCap(tx, draft))) continue;
          const inserted = await tx.$queryRaw<Array<{ id: string }>>`
            INSERT INTO impact_point_transactions
              ("id", "userId", "amount", "type", "reason", "entityType", "entityId", "problemId",
               "ruleVersion", "idempotencyKey", "actorUserId", "metadata", "createdAt")
            VALUES
              (gen_random_uuid(), ${draft.userId}::uuid, ${draft.amount},
               ${draft.type}::"ImpactTransactionType", ${draft.reason.slice(0, 500)},
               ${draft.entityType}, ${draft.entityId}::uuid, ${draft.problemId}::uuid,
               ${CURRENT_RULES.version}, ${draft.idempotencyKey}, ${draft.actorUserId ?? null}::uuid,
               ${JSON.stringify(draft.metadata ?? {})}::jsonb, ${new Date()})
            ON CONFLICT ("idempotencyKey") DO NOTHING
            RETURNING id
          `;
          if (inserted.length === 1) {
            total += draft.amount;
            rows += 1;
          }
        }
        if (rows > 0) {
          await tx.$executeRaw`
            INSERT INTO user_impact_stats ("userId", "impactPoints", "resolvedContributions", "updatedAt")
            VALUES (${userId}::uuid, ${total}, 0, now())
            ON CONFLICT ("userId") DO UPDATE
              SET "impactPoints" = user_impact_stats."impactPoints" + EXCLUDED."impactPoints",
                  "updatedAt" = now()
          `;
          await tx.$executeRaw`
            UPDATE user_impact_stats SET "resolvedContributions" = (
              SELECT count(DISTINCT t."problemId")::int FROM impact_point_transactions t
              WHERE t."userId" = ${userId}::uuid AND t."problemId" IS NOT NULL
                AND t.type::text = ANY (${[...RESOLUTION_TYPES]}::text[])
            ) WHERE "userId" = ${userId}::uuid
          `;
        }
        created += rows;
        return total;
      });
      if (added !== 0) byUser.set(userId, added);
    }

    for (const [userId, points] of byUser) {
      await this.afterAward(userId).catch((error: unknown) =>
        this.logger.warn(
          `Reputation/badge refresh failed for ${userId}: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
      );
      if (notice && points >= CURRENT_RULES.thresholds.notifyMinPoints) {
        this.events.publish({
          type: 'IMPACT_POINTS_AWARDED',
          userId,
          points,
          headline: notice.headline,
          problemPublicId: notice.problemPublicId,
          eventKey: notice.eventKey,
        });
      }
    }
    if (created > 0)
      this.logger.log(`Impact: ${created} transaction(s) for ${byUser.size} user(s)`);
    return { created, byUser };
  }

  /** Reputation, tier and badges for one user. Bounded queries, never a full scan. */
  async afterAward(userId: string): Promise<void> {
    await this.reputation.recompute(userId);
    await this.badges.evaluate(userId);
  }

  private async underCap(
    tx: Prisma.TransactionClient,
    draft: AwardDraft,
  ): Promise<boolean> {
    const group = CAP_GROUPS[draft.type];
    if (!group) return true;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [row] = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM impact_point_transactions
      WHERE "userId" = ${draft.userId}::uuid AND "createdAt" >= ${since}
        AND type::text = ANY (${group.types}::text[])
        AND "idempotencyKey" <> ${draft.idempotencyKey}
    `;
    if ((row?.n ?? 0) >= group.cap) {
      this.logger.log(
        `Impact cap reached for ${draft.userId} (${draft.type}); not awarded`,
      );
      return false;
    }
    return true;
  }
}
