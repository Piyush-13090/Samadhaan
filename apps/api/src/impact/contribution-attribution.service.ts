import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { CURRENT_RULES, idempotencyKey } from './impact-rules.js';
import { ImpactLedgerService, type AwardDraft } from './impact-ledger.service.js';

const P = CURRENT_RULES.points;
const C = CURRENT_RULES.caps;
const VERIFIED_OR_LATER = ['VERIFIED', 'IN_PROGRESS', 'RESOLVED'];

export interface ResolutionInput {
  problem: { id: string; publicId: string; reporterId: string };
  /** Reporters of confirmed duplicates of this problem. */
  duplicateReporters: Array<{ problemId: string; reporterId: string }>;
  /** Supporters and substantive commenters before verification, earliest first. */
  community: Array<{ userId: string; commented: boolean }>;
  /** Members of the assigned organisation — credited for their project work instead. */
  projectMembers: ReadonlySet<string>;
  project: {
    id: string;
    tasks: Array<{ id: string; completedById: string | null }>;
    milestones: Array<{ id: string; completedById: string | null }>;
    evidence: Array<{ submittedById: string; quality: number | null }>;
    requesterId: string | null;
  } | null;
}

/**
 * Who earns what when the government verifies a problem as resolved — a pure,
 * deterministic function of the record (Prompt 23). Every draft carries an
 * idempotency key, so running it twice awards nothing new.
 */
export function attributeResolution(input: ResolutionInput): AwardDraft[] {
  const { problem } = input;
  const drafts: AwardDraft[] = [];
  const base = { entityType: 'Problem', entityId: problem.id, problemId: problem.id };
  const add = (
    userId: string,
    type: AwardDraft['type'],
    amount: number,
    reason: string,
    key: string,
    metadata: Record<string, unknown> = {},
    entity: Partial<Pick<AwardDraft, 'entityType' | 'entityId'>> = {},
  ) =>
    drafts.push({
      ...base,
      ...entity,
      userId,
      type,
      amount,
      reason,
      idempotencyKey: key,
      metadata,
    });

  add(
    problem.reporterId,
    'PROBLEM_RESOLVED',
    P.PROBLEM_RESOLVED_REPORTER,
    `Your report ${problem.publicId} was resolved`,
    idempotencyKey('PROBLEM_RESOLVED', problem.id, problem.reporterId, 'reporter'),
    { role: 'reporter' },
  );

  const corroborators = new Set<string>();
  for (const dup of input.duplicateReporters) {
    if (dup.reporterId === problem.reporterId || corroborators.has(dup.reporterId))
      continue;
    corroborators.add(dup.reporterId);
    add(
      dup.reporterId,
      'PROBLEM_RESOLVED',
      P.PROBLEM_RESOLVED_CORROBORATOR,
      `A problem you also reported (${problem.publicId}) was resolved`,
      idempotencyKey('PROBLEM_RESOLVED', problem.id, dup.reporterId, 'corroborator'),
      { role: 'corroborator', duplicateProblemId: dup.problemId },
    );
  }

  // Community: early, substantive contributors — not the reporter, not the
  // people paid in project credit, capped per problem.
  let community = 0;
  for (const c of input.community) {
    if (community >= C.communityContributorsPerProblem) break;
    if (
      c.userId === problem.reporterId ||
      input.projectMembers.has(c.userId) ||
      corroborators.has(c.userId)
    )
      continue;
    community += 1;
    if (c.commented) {
      add(
        c.userId,
        'USEFUL_COMMENT',
        P.USEFUL_COMMENT,
        `Your early comment helped ${problem.publicId}, now resolved`,
        idempotencyKey('USEFUL_COMMENT', problem.id, c.userId),
      );
    } else {
      add(
        c.userId,
        'PROBLEM_SUPPORTED',
        P.PROBLEM_SUPPORTED,
        `You supported ${problem.publicId} early; it is now resolved`,
        idempotencyKey('PROBLEM_SUPPORTED', problem.id, c.userId),
      );
    }
  }

  const project = input.project;
  if (project) {
    const projectEntity = { entityType: 'ResolutionProject', entityId: project.id };
    const perUser = new Map<string, number>();
    let projectTasks = 0;
    for (const task of project.tasks) {
      if (!task.completedById || !input.projectMembers.has(task.completedById)) continue;
      const done = perUser.get(task.completedById) ?? 0;
      if (done >= C.tasksPerUserPerProject || projectTasks >= C.tasksPerProject) continue;
      perUser.set(task.completedById, done + 1);
      projectTasks += 1;
      add(
        task.completedById,
        'TASK_COMPLETED',
        P.TASK_COMPLETED,
        `Task completed on the resolved project for ${problem.publicId}`,
        idempotencyKey('TASK_COMPLETED', task.id, task.completedById),
        {},
        { entityType: 'ResolutionTask', entityId: task.id },
      );
    }
    const milestonesPerUser = new Map<string, number>();
    for (const m of project.milestones) {
      if (!m.completedById || !input.projectMembers.has(m.completedById)) continue;
      const done = milestonesPerUser.get(m.completedById) ?? 0;
      if (done >= C.milestonesPerUserPerProject) continue;
      milestonesPerUser.set(m.completedById, done + 1);
      add(
        m.completedById,
        'MILESTONE_COMPLETED',
        P.MILESTONE_COMPLETED,
        `Milestone completed on the resolved project for ${problem.publicId}`,
        idempotencyKey('MILESTONE_COMPLETED', m.id, m.completedById),
        {},
        { entityType: 'ResolutionMilestone', entityId: m.id },
      );
    }
    const submitters = new Map<string, number | null>();
    for (const e of project.evidence) {
      const best = submitters.get(e.submittedById);
      submitters.set(e.submittedById, Math.max(best ?? -1, e.quality ?? -1));
    }
    for (const [userId, quality] of submitters) {
      add(
        userId,
        'RESOLUTION_EVIDENCE_SUBMITTED',
        P.RESOLUTION_EVIDENCE_SUBMITTED,
        `Your evidence for ${problem.publicId} was approved`,
        idempotencyKey('RESOLUTION_EVIDENCE_SUBMITTED', project.id, userId),
        {},
        projectEntity,
      );
      if (
        quality !== null &&
        quality >= CURRENT_RULES.thresholds.qualityBonusMinEvidenceQuality
      ) {
        add(
          userId,
          'QUALITY_BONUS',
          P.QUALITY_BONUS,
          `High-quality evidence for ${problem.publicId}`,
          idempotencyKey('QUALITY_BONUS', project.id, userId),
          { evidenceQuality: quality },
          projectEntity,
        );
      }
    }
    if (project.requesterId) {
      add(
        project.requesterId,
        'PROJECT_CONTRIBUTION',
        P.PROJECT_CONTRIBUTION,
        `The project for ${problem.publicId} was verified complete`,
        idempotencyKey('PROJECT_CONTRIBUTION', project.id, project.requesterId),
        {},
        projectEntity,
      );
    }
  }
  return drafts;
}

/**
 * Turns confirmed civic outcomes into impact points (Prompt 23):
 *
 * - **Verified report** — the government verified it.
 * - **Duplicate identified** — the reporter confirmed their report duplicates
 *   a problem the government verified (awarded when both are true, whichever
 *   comes last).
 * - **Resolution** — the government approved the resolution; see
 *   `attributeResolution`.
 *
 * Nothing is awarded for filing, supporting, commenting or following by
 * themselves, and nothing for a decision made by the person rewarded.
 */
@Injectable()
export class ContributionAttributionService {
  private readonly logger = new Logger(ContributionAttributionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: ImpactLedgerService,
  ) {}

  async onVerified(problemId: string): Promise<void> {
    const problem = await this.prisma.problem.findUnique({
      where: { id: problemId },
      select: {
        id: true,
        publicId: true,
        reporterId: true,
        status: true,
        deletedAt: true,
      },
    });
    if (!problem || problem.deletedAt || !VERIFIED_OR_LATER.includes(problem.status))
      return;
    await this.ledger.award(
      [
        {
          userId: problem.reporterId,
          type: 'PROBLEM_VERIFIED',
          amount: P.PROBLEM_VERIFIED,
          reason: `Your report ${problem.publicId} was verified by the government`,
          entityType: 'Problem',
          entityId: problem.id,
          problemId: problem.id,
          idempotencyKey: idempotencyKey(
            'PROBLEM_VERIFIED',
            problem.id,
            problem.reporterId,
          ),
        },
      ],
      {
        headline: `Your report ${problem.publicId} was verified.`,
        problemPublicId: problem.publicId,
        eventKey: `verified:${problem.id}`,
      },
    );
    // Duplicates confirmed before this verification now qualify.
    const duplicates = await this.prisma.problem.findMany({
      where: { duplicateOfId: problem.id, status: 'DUPLICATE', deletedAt: null },
      select: { id: true },
    });
    for (const d of duplicates) await this.onDuplicateConfirmed(d.id);
  }

  async onDuplicateConfirmed(duplicateProblemId: string): Promise<void> {
    const duplicate = await this.prisma.problem.findUnique({
      where: { id: duplicateProblemId },
      select: {
        id: true,
        publicId: true,
        reporterId: true,
        status: true,
        duplicateOf: {
          select: { id: true, publicId: true, reporterId: true, status: true },
        },
      },
    });
    const original = duplicate?.duplicateOf;
    if (!duplicate || duplicate.status !== 'DUPLICATE' || !original) return;
    if (
      !VERIFIED_OR_LATER.includes(original.status) ||
      original.reporterId === duplicate.reporterId
    )
      return;
    // The reporter must have identified it themselves.
    const confirmation = await this.prisma.problemDuplicateCandidate.findFirst({
      where: {
        problemId: duplicate.id,
        candidateProblemId: original.id,
        status: 'CONFIRMED_DUPLICATE',
      },
      select: { reviewedById: true },
    });
    if (confirmation?.reviewedById !== duplicate.reporterId) return;
    await this.ledger.award(
      [
        {
          userId: duplicate.reporterId,
          type: 'DUPLICATE_IDENTIFIED',
          amount: P.DUPLICATE_IDENTIFIED,
          reason: `You confirmed ${duplicate.publicId} duplicates ${original.publicId}`,
          entityType: 'Problem',
          entityId: duplicate.id,
          problemId: original.id,
          idempotencyKey: idempotencyKey(
            'DUPLICATE_IDENTIFIED',
            duplicate.id,
            duplicate.reporterId,
          ),
        },
      ],
      {
        headline: `Your duplicate identification was confirmed.`,
        problemPublicId: original.publicId,
        eventKey: `duplicate:${duplicate.id}`,
      },
    );
  }

  async onResolved(problemId: string): Promise<void> {
    const problem = await this.prisma.problem.findUnique({
      where: { id: problemId },
      select: {
        id: true,
        publicId: true,
        reporterId: true,
        status: true,
        resolvedAt: true,
        submittedAt: true,
        createdAt: true,
      },
    });
    if (!problem || problem.status !== 'RESOLVED') return;

    // The cut-off for "early" community contribution: the verification.
    const [verifiedAudit] = await this.prisma.$queryRaw<Array<{ at: Date }>>`
      SELECT min("createdAt") AS at FROM audit_logs
      WHERE "entityType" = 'Problem' AND "entityId" = ${problem.id}::uuid
        AND action = 'PROBLEM_STATUS_CHANGED' AND metadata ->> 'to' = 'VERIFIED'
    `;
    const cutoff = verifiedAudit?.at ?? problem.resolvedAt ?? new Date();

    const [duplicates, community, project] = await Promise.all([
      this.prisma.problem.findMany({
        where: { duplicateOfId: problem.id, status: 'DUPLICATE', deletedAt: null },
        select: { id: true, reporterId: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.$queryRaw<Array<{ userId: string; commented: boolean }>>`
        SELECT x."userId", bool_or(x.commented) AS commented FROM (
          SELECT v."userId", v."createdAt" AS at, false AS commented FROM problem_votes v
          WHERE v."problemId" = ${problem.id}::uuid AND v."createdAt" <= ${cutoff}
          UNION ALL
          SELECT c."userId", c."createdAt", true FROM problem_comments c
          WHERE c."problemId" = ${problem.id}::uuid AND c."createdAt" <= ${cutoff}
            AND c."deletedAt" IS NULL
            AND char_length(btrim(c.body)) >= ${CURRENT_RULES.thresholds.commentMinChars}
        ) x
        JOIN users u ON u.id = x."userId" AND u."deletedAt" IS NULL AND u.status = 'ACTIVE'
        GROUP BY x."userId"
        ORDER BY min(x.at) ASC, x."userId" ASC
        LIMIT ${CURRENT_RULES.caps.communityContributorsPerProblem * 2}
      `,
      this.prisma.resolutionProject.findFirst({
        where: { problemId: problem.id, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        select: {
          id: true,
          assignedOrganizationId: true,
          tasks: {
            where: { status: 'COMPLETED' },
            select: { id: true, completedById: true },
            orderBy: { completedAt: 'asc' },
          },
          milestones: {
            where: { completedAt: { not: null } },
            select: { id: true, completedById: true },
            orderBy: { completedAt: 'asc' },
          },
          evidence: {
            where: { status: 'APPROVED' },
            select: {
              submittedById: true,
              assessments: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { evidenceQuality: true },
              },
            },
          },
          verificationRequests: {
            where: { status: 'APPROVED' },
            orderBy: { decidedAt: 'desc' },
            take: 1,
            select: { requestedById: true },
          },
        },
      }),
    ]);
    const members = project
      ? await this.prisma.organizationMember.findMany({
          where: { organizationId: project.assignedOrganizationId, status: 'ACTIVE' },
          select: { userId: true },
        })
      : [];

    const drafts = attributeResolution({
      problem,
      duplicateReporters: duplicates.map((d) => ({
        problemId: d.id,
        reporterId: d.reporterId,
      })),
      community,
      projectMembers: new Set(members.map((m) => m.userId)),
      project: project
        ? {
            id: project.id,
            tasks: project.tasks,
            milestones: project.milestones,
            evidence: project.evidence.map((e) => ({
              submittedById: e.submittedById,
              quality:
                e.assessments[0]?.evidenceQuality == null
                  ? null
                  : Number(e.assessments[0].evidenceQuality),
            })),
            requesterId: project.verificationRequests[0]?.requestedById ?? null,
          }
        : null,
    });
    const result = await this.ledger.award(drafts, {
      headline: `${problem.publicId} was resolved.`,
      problemPublicId: problem.publicId,
      eventKey: `resolved:${problem.id}`,
    });
    this.logger.log(
      `${problem.publicId} resolved: ${result.created} award(s) across ${result.byUser.size} contributor(s)`,
    );
  }
}
