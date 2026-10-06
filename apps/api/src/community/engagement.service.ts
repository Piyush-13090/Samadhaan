import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { FollowState, ProblemEngagement, SupportState } from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AccessibleProblem } from '../problems/problems.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';

type Tx = Prisma.TransactionClient;

/**
 * Support and follow.
 *
 * **Both are idempotent, and the database decides.** Adding inserts with
 * `ON CONFLICT DO NOTHING` (Prisma's `skipDuplicates`) and moves the counter by
 * however many rows were actually inserted — 0 or 1. Removing deletes and moves
 * it by however many rows were actually deleted. So:
 *
 *  - two simultaneous taps from one user: the second insert waits on the unique
 *    index, finds the row, inserts nothing, and the counter moves once;
 *  - a retried request after a network blip: a no-op, not a 409 the UI must
 *    special-case;
 *  - removing support you never gave: a no-op, never a negative count.
 *
 * The `@@unique([problemId, userId])` constraint is the final protection, as it
 * must be: no read-then-write check in Node survives two requests arriving in
 * the same millisecond.
 *
 * The denormalised `voteCount`/`followCount` columns already existed (the feed
 * sorts on them) and are maintained here in the same transaction as the row,
 * so they cannot drift from it.
 */
@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
  ) {}

  // ================================================================ support

  async support(problem: AccessibleProblem, user: RequestUser): Promise<SupportState> {
    assertAcceptsEngagement(problem);

    const { added, supportCount } = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.problemVote.createMany({
        data: [{ problemId: problem.id, userId: user.id }],
        skipDuplicates: true,
      });

      const updated = await moveCounter(tx, problem.id, 'voteCount', count);

      return { added: count > 0, supportCount: updated };
    });

    if (added) {
      this.events.publish({
        type: 'PROBLEM_SUPPORTED',
        problemId: problem.id,
        problemPublicId: problem.publicId,
        reporterId: problem.reporterId,
        actorUserId: user.id,
      });
    }

    return { supportCount, supportedByCurrentUser: true };
  }

  /**
   * Withdraws support.
   *
   * Allowed on a duplicate even though adding is not: a citizen must always be
   * able to take back something they said.
   */
  async unsupport(problem: AccessibleProblem, user: RequestUser): Promise<SupportState> {
    const supportCount = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.problemVote.deleteMany({
        where: { problemId: problem.id, userId: user.id },
      });

      const updated = await moveCounter(tx, problem.id, 'voteCount', -count);

      return updated;
    });

    return { supportCount, supportedByCurrentUser: false };
  }

  async supportState(
    problem: AccessibleProblem,
    viewer: RequestUser | null,
  ): Promise<SupportState> {
    const [row, mine] = await Promise.all([
      this.prisma.problem.findUniqueOrThrow({
        where: { id: problem.id },
        select: { voteCount: true },
      }),
      viewer
        ? this.prisma.problemVote.findUnique({
            where: { problemId_userId: { problemId: problem.id, userId: viewer.id } },
            select: { id: true },
          })
        : null,
    ]);

    return { supportCount: row.voteCount, supportedByCurrentUser: Boolean(mine) };
  }

  // ================================================================= follow

  async follow(problem: AccessibleProblem, user: RequestUser): Promise<FollowState> {
    assertAcceptsEngagement(problem);

    const { added, followerCount } = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.problemFollow.createMany({
        data: [{ problemId: problem.id, userId: user.id }],
        skipDuplicates: true,
      });

      const updated = await moveCounter(tx, problem.id, 'followCount', count);

      return { added: count > 0, followerCount: updated };
    });

    if (added) {
      this.events.publish({
        type: 'PROBLEM_FOLLOWED',
        problemId: problem.id,
        problemPublicId: problem.publicId,
        actorUserId: user.id,
      });
    }

    return { followerCount, followedByCurrentUser: true };
  }

  async unfollow(problem: AccessibleProblem, user: RequestUser): Promise<FollowState> {
    const followerCount = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.problemFollow.deleteMany({
        where: { problemId: problem.id, userId: user.id },
      });

      const updated = await moveCounter(tx, problem.id, 'followCount', -count);

      return updated;
    });

    return { followerCount, followedByCurrentUser: false };
  }

  async followState(
    problem: AccessibleProblem,
    viewer: RequestUser | null,
  ): Promise<FollowState> {
    const [row, mine] = await Promise.all([
      this.prisma.problem.findUniqueOrThrow({
        where: { id: problem.id },
        select: { followCount: true },
      }),
      viewer
        ? this.prisma.problemFollow.findUnique({
            where: { problemId_userId: { problemId: problem.id, userId: viewer.id } },
            select: { id: true },
          })
        : null,
    ]);

    return { followerCount: row.followCount, followedByCurrentUser: Boolean(mine) };
  }

  // ============================================================== summary

  /**
   * The problem page header in one read: three counters from the problem row
   * and two indexed existence checks for the viewer. No `COUNT(*)` — the
   * counters are maintained, so reading them is a primary-key lookup.
   */
  async summary(
    problem: AccessibleProblem,
    viewer: RequestUser | null,
  ): Promise<ProblemEngagement> {
    const [row, vote, follow] = await Promise.all([
      this.prisma.problem.findUniqueOrThrow({
        where: { id: problem.id },
        select: { voteCount: true, followCount: true, commentCount: true },
      }),
      viewer
        ? this.prisma.problemVote.findUnique({
            where: { problemId_userId: { problemId: problem.id, userId: viewer.id } },
            select: { id: true },
          })
        : null,
      viewer
        ? this.prisma.problemFollow.findUnique({
            where: { problemId_userId: { problemId: problem.id, userId: viewer.id } },
            select: { id: true },
          })
        : null,
    ]);

    return {
      supportCount: row.voteCount,
      supportedByCurrentUser: Boolean(vote),
      followerCount: row.followCount,
      followedByCurrentUser: Boolean(follow),
      commentCount: row.commentCount,
      acceptsEngagement: acceptsEngagement(problem),
      duplicateOfPublicId: problem.duplicateOfPublicId,
    };
  }
}

/**
 * Whether new support, follows and comments are accepted.
 *
 * A confirmed duplicate is closed: its supporters belong on the canonical
 * report, and splitting them across two records would understate the very
 * signal support exists to measure. A draft never reaches here for anyone but
 * its reporter, and is closed too — there is no community around an
 * unpublished report.
 */
export function acceptsEngagement(problem: AccessibleProblem): boolean {
  return problem.status !== 'DUPLICATE' && problem.status !== 'DRAFT';
}

export function assertAcceptsEngagement(problem: AccessibleProblem): void {
  if (acceptsEngagement(problem)) return;

  throw AppException.conflict(
    problem.duplicateOfPublicId
      ? `This report is a duplicate of ${problem.duplicateOfPublicId}. Support and discuss it there.`
      : 'This report is not open for community activity.',
  );
}

/** The maintained counters on `problems`. A closed set, so the column name is never input. */
export type ProblemCounter = 'voteCount' | 'followCount' | 'commentCount';

/**
 * Moves a counter by `delta` and returns its new value.
 *
 * Raw SQL rather than `tx.problem.update`, for two reasons. `x = x + n` is a
 * single atomic statement that takes the row lock, so concurrent supporters
 * serialise on it rather than overwriting each other's read. And Prisma's
 * `update` would also bump `updatedAt` — someone tapping Support is not an edit
 * to the report, and anything that later reads `updatedAt` as "the report
 * changed" would be misled.
 *
 * A zero delta still reads the value, inside the same transaction, so the
 * caller always gets the count as of its own write.
 */
export async function moveCounter(
  tx: Tx,
  problemId: string,
  counter: ProblemCounter,
  delta: number,
): Promise<number> {
  const column = Prisma.raw(`"${counter}"`);

  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    UPDATE problems
    SET ${column} = ${column} + ${delta}::int
    WHERE id = ${problemId}::uuid
    RETURNING ${column} AS "value"
  `;

  const value = rows[0]?.value;
  if (value === undefined) throw AppException.notFound('Problem');
  return value;
}
