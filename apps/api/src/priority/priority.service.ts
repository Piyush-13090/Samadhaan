import { Injectable, Logger } from '@nestjs/common';
import type {
  GovernmentPriorityView,
  PriorityOverrideView,
  PriorityReason,
  PriorityTier,
  PublicPriorityView,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import type { GovernmentScope } from '../government/government-access.service.js';
import { GovernmentProblemsService } from '../government/government-problems.service.js';
import { ProblemsService } from '../problems/problems.service.js';
import { ASSESSABLE_STATUSES } from './priority-feature.service.js';
import { PriorityCalculationService } from './priority-calculation.service.js';

/** What a citizen may read about why a problem is prioritised. */
const PUBLIC_FEATURES = new Set([
  'severity',
  'safetyRisk',
  'communityImpact',
  'geographicImpact',
]);
/** Priority is published once a government office has verified the report. */
const PUBLIC_STATUSES = new Set(['VERIFIED', 'IN_PROGRESS']);

/**
 * Priority as government officials see and decide it, and as the public sees
 * it (Prompt 21).
 *
 * Officials: the full AI assessment, its history, and a controlled override —
 * a tier and a required reason, audited, never touching the AI score. Access
 * is the government portal's: role GOVERNMENT, active membership of an
 * operational office (GovernmentGuard), and the problem inside that office's
 * jurisdiction (`findInScope`, 404 otherwise).
 *
 * Public: the effective level and plain reasons from public signals only — no
 * score, no confidence figures, no override or its reason.
 */
@Injectable()
export class PriorityService {
  private readonly logger = new Logger(PriorityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculation: PriorityCalculationService,
    private readonly governmentProblems: GovernmentProblemsService,
    private readonly problems: ProblemsService,
  ) {}

  async governmentView(
    scope: GovernmentScope,
    publicId: string,
  ): Promise<GovernmentPriorityView> {
    const problem = await this.governmentProblems.findInScope(scope, publicId);
    return this.buildGovernmentView(problem.id, problem.status);
  }

  /** Runs the pipeline now for one problem. Rate-limited at the controller. */
  async recalculate(
    scope: GovernmentScope,
    publicId: string,
    refreshAi: boolean,
  ): Promise<GovernmentPriorityView> {
    const problem = await this.governmentProblems.findInScope(scope, publicId);
    if (!(ASSESSABLE_STATUSES as readonly string[]).includes(problem.status)) {
      throw AppException.conflict(
        `A ${problem.status.replace('_', ' ').toLowerCase()} problem is not prioritised.`,
      );
    }
    await this.calculation.calculate(problem.id, 'manual', { forceAi: refreshAi });
    return this.buildGovernmentView(problem.id, problem.status);
  }

  async setOverride(
    scope: GovernmentScope,
    publicId: string,
    input: { tier: PriorityTier; reason: string },
    user: RequestUser,
  ): Promise<GovernmentPriorityView> {
    const problem = await this.governmentProblems.findInScope(scope, publicId);
    if (!(ASSESSABLE_STATUSES as readonly string[]).includes(problem.status)) {
      throw AppException.conflict(
        `A ${problem.status.replace('_', ' ').toLowerCase()} problem cannot be given a priority.`,
      );
    }
    const reason = input.reason.trim();

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`priority:${problem.id}`}))`;
      const [existing, current, latest] = await Promise.all([
        tx.problemPriorityOverride.findUnique({ where: { problemId: problem.id } }),
        tx.problem.findUniqueOrThrow({
          where: { id: problem.id },
          select: { priorityTier: true, priorityScore: true },
        }),
        tx.problemPriorityAssessment.findFirst({
          where: { problemId: problem.id },
          orderBy: { calculatedAt: 'desc' },
          select: { id: true },
        }),
      ]);
      if (existing && existing.priorityTier === input.tier && existing.reason === reason)
        return;

      const fromTier = existing?.priorityTier ?? current.priorityTier ?? null;
      const aiTier = current.priorityTier ?? null;
      const aiScore = current.priorityTier ? Number(current.priorityScore) : null;
      await tx.problemPriorityOverride.upsert({
        where: { problemId: problem.id },
        create: {
          problemId: problem.id,
          priorityTier: input.tier,
          reason,
          organizationId: scope.organization.id,
          overriddenById: user.id,
          aiTier,
          aiScore,
          assessmentId: latest?.id ?? null,
        },
        update: {
          priorityTier: input.tier,
          reason,
          organizationId: scope.organization.id,
          overriddenById: user.id,
          aiTier,
          aiScore,
          assessmentId: latest?.id ?? null,
          overriddenAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: existing ? 'PRIORITY_OVERRIDE_UPDATED' : 'PRIORITY_OVERRIDE_CREATED',
          entityType: 'Problem',
          entityId: problem.id,
          metadata: {
            organizationId: scope.organization.id,
            organizationName: scope.organization.name,
            fromTier,
            toTier: input.tier,
            aiTier,
            aiScore,
            assessmentId: latest?.id ?? null,
            note: reason,
          },
        },
      });
    });

    this.logger.log(
      `${problem.publicId}: priority override ${input.tier} by ${scope.organization.slug}`,
    );
    return this.buildGovernmentView(problem.id, problem.status);
  }

  async removeOverride(
    scope: GovernmentScope,
    publicId: string,
    reason: string | null,
    user: RequestUser,
  ): Promise<GovernmentPriorityView> {
    const problem = await this.governmentProblems.findInScope(scope, publicId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`priority:${problem.id}`}))`;
      const existing = await tx.problemPriorityOverride.findUnique({
        where: { problemId: problem.id },
      });
      if (!existing) throw AppException.notFound('Priority override');
      const current = await tx.problem.findUniqueOrThrow({
        where: { id: problem.id },
        select: { priorityTier: true, priorityScore: true },
      });
      await tx.problemPriorityOverride.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'PRIORITY_OVERRIDE_REMOVED',
          entityType: 'Problem',
          entityId: problem.id,
          metadata: {
            organizationId: scope.organization.id,
            organizationName: scope.organization.name,
            fromTier: existing.priorityTier,
            toTier: current.priorityTier ?? null,
            aiTier: current.priorityTier ?? null,
            aiScore: current.priorityTier ? Number(current.priorityScore) : null,
            previousReason: existing.reason,
            note: reason,
          },
        },
      });
    });
    this.logger.log(
      `${problem.publicId}: priority override removed by ${scope.organization.slug}`,
    );
    return this.buildGovernmentView(problem.id, problem.status);
  }

  /** Anyone who can see the problem. Only once it has been verified. */
  async publicView(
    publicId: string,
    viewer: RequestUser | null,
  ): Promise<PublicPriorityView> {
    const visible = await this.problems.findByPublicId(publicId, viewer); // 404 unless visible
    const problem = await this.prisma.problem.findUniqueOrThrow({
      where: { publicId: visible.publicId },
      select: {
        id: true,
        status: true,
        priorityTier: true,
        priorityAssessedAt: true,
        priorityOverride: { select: { priorityTier: true } },
      },
    });
    const level = problem.priorityOverride?.priorityTier ?? problem.priorityTier;
    if (!PUBLIC_STATUSES.has(problem.status) || !level) {
      return { level: null, reasons: [], assessedAt: null };
    }
    const latest = await this.calculation.latest(problem.id);
    const reasons = ((latest?.explanation ?? []) as unknown as PriorityReason[])
      .filter((r) => r.kind === 'driver' && r.feature && PUBLIC_FEATURES.has(r.feature))
      // Plain wording: no quoted phrases, figures or model output.
      .map((r) => r.text.replace(/:\s*“.*”$/, '').trim())
      .slice(0, 3);
    return {
      level: level as PriorityTier,
      reasons,
      assessedAt: problem.priorityAssessedAt?.toISOString() ?? null,
    };
  }

  private async buildGovernmentView(
    problemId: string,
    status: string,
  ): Promise<GovernmentPriorityView> {
    const [history, override] = await Promise.all([
      this.calculation.history(problemId, 10),
      this.prisma.problemPriorityOverride.findUnique({
        where: { problemId },
        include: {
          organization: { select: { name: true } },
          overriddenBy: { select: { fullName: true } },
        },
      }),
    ]);
    const latest = history[0] ?? null;
    const overrideView: PriorityOverrideView | null = override
      ? {
          tier: override.priorityTier as PriorityTier,
          reason: override.reason,
          organizationName: override.organization.name,
          overriddenBy: override.overriddenBy.fullName,
          overriddenAt: override.overriddenAt.toISOString(),
          aiTierAtOverride: (override.aiTier as PriorityTier | null) ?? null,
          aiScoreAtOverride: override.aiScore === null ? null : Number(override.aiScore),
        }
      : null;
    return {
      assessment: latest ? await this.calculation.view(latest) : null,
      override: overrideView,
      effective: overrideView
        ? { tier: overrideView.tier, source: 'OVERRIDE' }
        : latest
          ? { tier: latest.priorityTier as PriorityTier, source: 'AI' }
          : { tier: null, source: null },
      history: history.map((row) => ({
        id: row.id,
        score: Number(row.priorityScore),
        tier: row.priorityTier as PriorityTier,
        calculatedAt: row.calculatedAt.toISOString(),
        trigger: row.trigger,
        changes: Array.isArray(row.changes) ? (row.changes as string[]) : [],
      })),
      canOverride: (ASSESSABLE_STATUSES as readonly string[]).includes(status),
    };
  }
}
