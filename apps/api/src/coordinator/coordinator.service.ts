import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  PROJECT_EDITABLE_STATUSES,
  type CoordinatorBlocker,
  type CoordinatorQuestionView,
  type CoordinatorRisk,
  type CoordinatorView,
  type ExtractedUpdateView,
  type ProjectHealth,
  type ProjectUpdateView,
  type QuestionCategory,
  type SourceReference,
} from '@samadhaan/shared';
import { AiService } from '../ai/ai.service.js';
import type { AiCoordinatorResult } from '../ai/dto/coordinator.dto.js';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import { Prisma, type ResolutionProject } from '../generated/prisma/client.js';
import { RedisService } from '../redis/redis.service.js';
import type { ProjectContext } from '../resolution/projects.service.js';
import {
  CoordinatorContextService,
  type BuiltContext,
} from './coordinator-context.service.js';
import { SIGNAL_RISK_TYPE, type EngineResult } from './health-engine.js';

const HEALTH_ORDER: Record<ProjectHealth, number> = {
  HEALTHY: 0,
  NEEDS_ATTENTION: 1,
  AT_RISK: 2,
  BLOCKED: 3,
};

const HEALTH_LABEL: Record<ProjectHealth, string> = {
  HEALTHY: 'healthy',
  NEEDS_ATTENTION: 'needs attention',
  AT_RISK: 'at risk',
  BLOCKED: 'blocked',
};

type StoredFinding = {
  title: string;
  description: string;
  sourceRefs: string[];
  type?: string;
  severity?: string;
};

/**
 * The AI Project Coordinator (Prompt 19).
 *
 *   live, deterministic          cached, AI
 *   ─────────────────────        ────────────────────────────────────
 *   health + reasons             summary, interpretation of health
 *   signals → risks, blockers    AI risks, potential blockers (unconfirmed)
 *   deadlines                    suggestions, questions
 *
 * Advisory only. Nothing here assigns, transitions, approves or verifies:
 * it reads the project and writes insights, questions and — when a person
 * confirms one — structured updates. Every AI finding cites refs the API
 * itself sent; refs that no longer resolve are dropped when shown.
 */
@Injectable()
export class CoordinatorService {
  private readonly logger = new Logger(CoordinatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly context: CoordinatorContextService,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
    private readonly events: DomainEventBus,
  ) {}

  // ================================================================== view

  async view(pc: ProjectContext): Promise<CoordinatorView> {
    const { project } = pc;
    await this.expireQuestions(project);
    const now = new Date();
    const state = await this.context.health(project);

    const [completed, latest, questions, cooldown] = await Promise.all([
      this.prisma.projectAIInsight.findFirst({
        where: { projectId: project.id, status: 'COMPLETED' },
        orderBy: { generatedAt: 'desc' },
      }),
      this.prisma.projectAIInsight.findFirst({
        where: { projectId: project.id },
        orderBy: { generatedAt: 'desc' },
        select: { status: true, generatedAt: true, failureMessage: true },
      }),
      this.prisma.coordinatorQuestion.findMany({
        where: {
          projectId: project.id,
          OR: [
            { status: 'OPEN' },
            {
              status: 'ANSWERED',
              answeredAt: { gte: new Date(now.getTime() - 14 * 86_400_000) },
            },
          ],
        },
        include: { answeredBy: { select: { fullName: true } } },
        orderBy: [{ status: 'desc' }, { askedAt: 'desc' }],
        take: 10,
      }),
      this.cooldownRemaining(project.id),
    ]);

    // Resolve every ref the stored insight and questions cite, in one pass.
    const cited = [
      ...findingRefs(completed?.risks),
      ...findingRefs(completed?.blockers),
      ...findingRefs(completed?.suggestions),
      ...questions.flatMap((q) => (q.targetRef ? [q.targetRef] : [])),
    ];
    const refs = await this.context.resolve(project, cited, state.refs);
    const sources = (list: string[]) =>
      list
        .map((ref) => refs.get(ref))
        .filter((s): s is SourceReference => s !== undefined);

    const insight = completed
      ? {
          health: completed.health!,
          healthReason: completed.healthReason ?? '',
          summary: completed.summary!,
          risks: storedFindings(completed.risks)
            .map((f) => ({
              type: (f.type ?? 'OTHER') as CoordinatorRisk['type'],
              severity: (f.severity ?? 'MEDIUM') as CoordinatorRisk['severity'],
              title: f.title,
              description: f.description,
              sources: sources(f.sourceRefs),
              origin: 'AI' as const,
            }))
            .filter((f) => f.sources.length > 0),
          blockers: storedFindings(completed.blockers)
            .map((f) => ({
              title: f.title,
              description: f.description,
              sources: sources(f.sourceRefs),
              origin: 'AI' as const,
            }))
            .filter((f) => f.sources.length > 0),
          suggestions: storedFindings(completed.suggestions)
            .map((f) => ({ text: f.description, sources: sources(f.sourceRefs) }))
            .filter((f) => f.sources.length > 0),
          generatedAt: completed.generatedAt.toISOString(),
          expiresAt: completed.expiresAt.toISOString(),
          stale:
            completed.expiresAt < now || state.lastChangeAt > completed.basedOnChangeAt,
          model: {
            provider: completed.provider,
            name: completed.modelName,
            version: completed.modelVersion,
            promptVersion: completed.promptVersion,
          },
        }
      : null;

    const live = this.deterministicFindings(state.engine, state.refs);
    if (insight) {
      // An AI risk that only restates a live signal adds nothing: show it once,
      // as the rule. AI risks resting on messages, updates or events stay.
      const covered = new Set(
        live.risks.flatMap((r) => r.sources.map((s) => `${s.kind}:${s.id}`)),
      );
      insight.risks = insight.risks.filter(
        (risk) =>
          !risk.sources.every(
            (s) => s.kind === 'signal' || covered.has(`${s.kind}:${s.id}`),
          ),
      );
    }
    const open =
      PROJECT_EDITABLE_STATUSES.includes(project.status) &&
      pc.room.room.status === 'OPEN';

    return {
      health: {
        level: state.engine.health,
        reasons: state.engine.reasons,
        signals: state.engine.signals.map((s) => ({
          code: s.code,
          severity: s.severity,
          title: s.title,
          source: s.sourceRef ? (state.refs.get(s.sourceRef) ?? null) : null,
        })),
      },
      risks: live.risks,
      blockers: live.blockers,
      deadlines: state.engine.deadlines.map((d) => ({
        kind: d.kind,
        title: d.title,
        dueDate: d.dueDate,
        daysLeft: d.daysLeft,
        source: d.sourceRef ? (state.refs.get(d.sourceRef) ?? null) : null,
      })),
      insight,
      lastFailure:
        latest?.status === 'FAILED' &&
        (!completed || latest.generatedAt > completed.generatedAt)
          ? {
              at: latest.generatedAt.toISOString(),
              message: latest.failureMessage ?? 'The analysis failed.',
            }
          : null,
      questions: questions.map((q) => this.toQuestionView(q, refs)),
      refreshAvailableAt:
        cooldown > 0 ? new Date(now.getTime() + cooldown * 1000).toISOString() : null,
      canRefresh: this.config.coordinator.enabled && open,
      canAnswer: open,
      canPostUpdates: open && pc.room.side === 'ORGANIZATION',
    };
  }

  // =============================================================== refresh

  /** A person asked for fresh insights. Rate-limited per project. */
  async refreshManually(pc: ProjectContext, user: RequestUser): Promise<void> {
    if (!this.config.coordinator.enabled) {
      throw new AppException(
        ERROR_CODES.UPSTREAM_UNAVAILABLE,
        'The AI coordinator is turned off.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (
      !PROJECT_EDITABLE_STATUSES.includes(pc.project.status) ||
      pc.room.room.status !== 'OPEN'
    ) {
      throw AppException.conflict('Insights are refreshed only for live projects.');
    }
    const cooldown = this.config.coordinator.refreshCooldownSeconds;
    if (cooldown > 0) {
      const acquired = await this.redis.connection
        .set(cooldownKey(pc.project.id), user.id, 'EX', cooldown, 'NX')
        .catch(() => 'OK'); // Redis down: the per-user rate limit still applies.
      if (acquired !== 'OK') {
        const remaining = await this.cooldownRemaining(pc.project.id);
        throw new AppException(
          ERROR_CODES.RATE_LIMITED,
          `Insights were refreshed moments ago. Try again in ${Math.max(1, remaining)} seconds.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    const ok = await this.analyse(pc.project, user.id, 'MANUAL');
    if (!ok) {
      throw new AppException(
        ERROR_CODES.UPSTREAM_UNAVAILABLE,
        'AI insights could not be generated right now. The previous insights are kept.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * One analysis: context → AI → validated → persisted → questions →
   * notifications. Returns false (after recording a FAILED insight) when the
   * AI is unavailable or its output unusable; the previous insight stands.
   */
  async analyse(
    project: ResolutionProject,
    actorUserId: string | null,
    trigger: 'MANUAL' | 'SCHEDULED',
  ): Promise<boolean> {
    await this.expireQuestions(project);
    const built = await this.context.build(project);
    const outcome = await this.ai.coordinateProject(
      built.request,
      built.knownRefs,
      built.targetRefs,
    );
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.coordinator.insightTtlHours * 3_600_000,
    );

    if (!outcome.ok) {
      await this.prisma.projectAIInsight.create({
        data: {
          projectId: project.id,
          status: 'FAILED',
          trigger,
          requestedById: actorUserId,
          baselineHealth: built.engine.health,
          failureCode: outcome.failure.code,
          failureMessage: outcome.failure.message,
          provider: 'unavailable',
          modelName: 'unavailable',
          modelVersion: 'unavailable',
          promptVersion: 'unavailable',
          basedOnChangeAt: built.lastChangeAt,
          generatedAt: now,
          expiresAt,
        },
      });
      this.logger.warn(
        `Coordinator failed for project ${project.id}: ${outcome.failure.code}`,
      );
      return false;
    }

    const result = outcome.result;
    const previous = await this.prisma.projectAIInsight.findFirst({
      where: { projectId: project.id, status: 'COMPLETED' },
      orderBy: { generatedAt: 'desc' },
      select: { health: true, blockers: true },
    });

    const { insight, created } = await this.prisma.$transaction(async (tx) => {
      const insight = await tx.projectAIInsight.create({
        data: {
          projectId: project.id,
          status: 'COMPLETED',
          trigger,
          requestedById: actorUserId,
          baselineHealth: built.engine.health,
          health: result.health,
          healthReason: result.healthReason || built.engine.reasons.join('; ') || null,
          summary: result.summary,
          risks: result.risks as unknown as Prisma.InputJsonValue,
          blockers: result.blockers as unknown as Prisma.InputJsonValue,
          suggestions: result.suggestions.map((s) => ({
            title: s.text.slice(0, 160),
            description: s.text,
            sourceRefs: s.sourceRefs,
          })) as unknown as Prisma.InputJsonValue,
          deadlines: built.engine.deadlines as unknown as Prisma.InputJsonValue,
          signals: built.engine.signals as unknown as Prisma.InputJsonValue,
          provider: result.provider,
          modelName: result.modelName,
          modelVersion: result.modelVersion,
          promptVersion: result.promptVersion,
          processingMs: result.processingMs,
          droppedItems: result.droppedItems,
          basedOnChangeAt: built.lastChangeAt,
          generatedAt: now,
          expiresAt,
        },
      });
      const created = await this.createQuestions(tx, project.id, insight.id, result, now);
      return { insight, created };
    });

    await this.notify(project, built, result, previous, insight.id, created, actorUserId);
    return true;
  }

  // ============================================================= questions

  /**
   * Creates the model's questions that are new. Deterministic fingerprint —
   * category and target, or category and normalised text — and the partial
   * unique index keep one OPEN question per fingerprint; a fingerprint
   * answered or dismissed within the cool-down is not asked again; at most
   * `maxOpen` are open at once.
   */
  private async createQuestions(
    tx: Prisma.TransactionClient,
    projectId: string,
    insightId: string,
    result: AiCoordinatorResult,
    now: Date,
  ): Promise<Array<{ targetRef: string | null }>> {
    const settings = this.config.coordinator.questions;
    const openCount = await tx.coordinatorQuestion.count({
      where: { projectId, status: 'OPEN' },
    });
    let room = Math.max(0, settings.maxOpen - openCount);
    if (room === 0 || result.questions.length === 0) return [];

    const since = new Date(now.getTime() - settings.cooldownDays * 86_400_000);
    const created: Array<{ targetRef: string | null }> = [];
    for (const question of result.questions) {
      if (room === 0) break;
      const fingerprint = questionFingerprint(
        question.category,
        question.targetRef,
        question.question,
      );
      const recent = await tx.coordinatorQuestion.findFirst({
        where: {
          projectId,
          fingerprint,
          OR: [
            { status: 'OPEN' },
            { answeredAt: { gte: since } },
            { dismissedAt: { gte: since } },
          ],
        },
        select: { id: true },
      });
      if (recent) continue;
      const inserted = await tx.coordinatorQuestion.createMany({
        data: [
          {
            projectId,
            insightId,
            question: question.question,
            category: question.category,
            fingerprint,
            targetRef: question.targetRef,
            sourceRefs: question.sourceRefs,
            expiresAt: new Date(now.getTime() + settings.expiryDays * 86_400_000),
          },
        ],
        // A concurrent refresh that created it first wins (partial unique index).
        skipDuplicates: true,
      });
      if (inserted.count > 0) {
        created.push({ targetRef: question.targetRef });
        room -= 1;
      }
    }
    return created;
  }

  async answer(
    pc: ProjectContext,
    questionId: string,
    answer: string,
    user: RequestUser,
  ): Promise<void> {
    this.requireOpen(pc);
    const { count } = await this.prisma.coordinatorQuestion.updateMany({
      where: { id: questionId, projectId: pc.project.id, status: 'OPEN' },
      data: { status: 'ANSWERED', answer, answeredAt: new Date(), answeredById: user.id },
    });
    if (count === 0) await this.questionRefusal(pc, questionId);
  }

  async dismiss(
    pc: ProjectContext,
    questionId: string,
    user: RequestUser,
  ): Promise<void> {
    this.requireOpen(pc);
    if (!pc.canManage && pc.room.side !== 'GOVERNMENT') {
      throw AppException.forbidden(
        'Only coordinators can dismiss questions. You can answer it instead.',
      );
    }
    const { count } = await this.prisma.coordinatorQuestion.updateMany({
      where: { id: questionId, projectId: pc.project.id, status: 'OPEN' },
      data: { status: 'DISMISSED', dismissedAt: new Date(), dismissedById: user.id },
    });
    if (count === 0) await this.questionRefusal(pc, questionId);
  }

  /** Open questions past their expiry, or about work that is now done, expire. */
  private async expireQuestions(project: ResolutionProject): Promise<void> {
    const now = new Date();
    const open = await this.prisma.coordinatorQuestion.findMany({
      where: { projectId: project.id, status: 'OPEN' },
      select: { id: true, targetRef: true, expiresAt: true },
    });
    if (open.length === 0) return;
    const taskIds = open.flatMap((q) =>
      q.targetRef?.startsWith('task:') ? [q.targetRef.slice(5)] : [],
    );
    const finished = new Set(
      (
        await this.prisma.resolutionTask.findMany({
          where: { id: { in: taskIds }, status: { in: ['COMPLETED', 'CANCELLED'] } },
          select: { id: true },
        })
      ).map((t) => `task:${t.id}`),
    );
    const expired = open
      .filter(
        (q) => q.expiresAt < now || (q.targetRef !== null && finished.has(q.targetRef)),
      )
      .map((q) => q.id);
    if (expired.length > 0) {
      await this.prisma.coordinatorQuestion.updateMany({
        where: { id: { in: expired }, status: 'OPEN' },
        data: { status: 'EXPIRED' },
      });
    }
  }

  // =============================================================== updates

  /** Drafts a structured update from free text or recent messages. Not saved. */
  async extract(
    pc: ProjectContext,
    input: { text?: string; fromRecentMessages?: boolean },
    user: RequestUser,
  ): Promise<ExtractedUpdateView> {
    this.requireUpdater(pc);
    let text = input.text?.trim() ?? '';
    if (!text && input.fromRecentMessages) {
      // The caller's own side's recent messages since the last update.
      const last = await this.prisma.projectUpdate.findFirst({
        where: { projectId: pc.project.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const messages = await this.prisma.resolutionMessage.findMany({
        where: {
          roomId: pc.project.roomId,
          deletedAt: null,
          authorOrganizationId: pc.room.organization.id,
          ...(last ? { createdAt: { gt: last.createdAt } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { body: true },
      });
      text = messages
        .map((m) => m.body)
        .join('\n')
        .slice(0, 6000);
    }
    if (!text) {
      throw AppException.badRequest(
        input.fromRecentMessages
          ? 'There are no new messages from your team to draft an update from.'
          : 'Write a note to draft an update from.',
      );
    }
    const outcome = await this.ai.extractProjectUpdate(text, pc.project.name);
    if (!outcome.ok) {
      throw new AppException(
        ERROR_CODES.UPSTREAM_UNAVAILABLE,
        'The update draft could not be generated right now. You can write it yourself.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    void user;
    const u = outcome.update;
    return {
      summary: u.summary,
      completed: u.completed,
      current: u.current,
      blockers: u.blockers,
      nextSteps: u.nextSteps,
      confidence: null,
      model: {
        provider: u.provider,
        name: u.modelName,
        version: u.modelVersion,
        promptVersion: u.promptVersion,
      },
    };
  }

  async updates(
    pc: ProjectContext,
    cursor?: string,
  ): Promise<{ items: ProjectUpdateView[]; nextCursor: string | null }> {
    const limit = 20;
    const after = cursor ? decodeCursor(cursor) : null;
    const rows = await this.prisma.projectUpdate.findMany({
      where: {
        projectId: pc.project.id,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      include: {
        author: { select: { fullName: true } },
        authorOrganization: { select: { name: true, type: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toUpdateView),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString(
              'base64url',
            )
          : null,
    };
  }

  /**
   * A person posts — or confirms an AI draft of — a structured update. The
   * coordinator never posts on anyone's behalf; `source` only records that a
   * draft helped.
   */
  async postUpdate(
    pc: ProjectContext,
    input: {
      summary: string;
      completed: string[];
      current: string[];
      blockers: string[];
      nextSteps: string[];
      source: 'MANUAL' | 'AI_ASSISTED';
      aiModel: string | null;
    },
    user: RequestUser,
  ): Promise<ProjectUpdateView> {
    this.requireUpdater(pc);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.projectUpdate.create({
        data: {
          projectId: pc.project.id,
          authorId: user.id,
          authorOrganizationId: pc.room.organization.id,
          summary: input.summary,
          completed: input.completed,
          current: input.current,
          blockers: input.blockers,
          nextSteps: input.nextSteps,
          source: input.source,
          aiModel: input.source === 'AI_ASSISTED' ? input.aiModel : null,
        },
        include: {
          author: { select: { fullName: true } },
          authorOrganization: { select: { name: true, type: true } },
        },
      });
      await tx.resolutionRoomEvent.create({
        data: {
          roomId: pc.project.roomId,
          type: 'PROJECT_UPDATE_POSTED',
          actorId: user.id,
          metadata: {
            projectId: pc.project.id,
            updateId: created.id,
            subject: input.summary.slice(0, 160),
            organizationName: pc.room.organization.name,
          },
        },
      });
      return created;
    });
    return toUpdateView(row);
  }

  // =============================================================== helpers

  private deterministicFindings(
    engine: EngineResult,
    refs: Map<string, SourceReference>,
  ) {
    const risks: CoordinatorRisk[] = engine.signals.map((signal) => ({
      type: SIGNAL_RISK_TYPE[signal.code],
      severity: signal.severity,
      title: signal.title,
      description: signal.title,
      sources:
        signal.sourceRef && refs.get(signal.sourceRef)
          ? [refs.get(signal.sourceRef)!]
          : [],
      origin: 'RULE',
    }));
    const blockers: CoordinatorBlocker[] = engine.signals
      .filter((signal) => signal.code === 'BLOCKED_TASK')
      .map((signal) => ({
        title: signal.title,
        description: 'Marked blocked on the task board.',
        sources:
          signal.sourceRef && refs.get(signal.sourceRef)
            ? [refs.get(signal.sourceRef)!]
            : [],
        origin: 'RULE',
      }));
    return { risks, blockers };
  }

  private async notify(
    project: ResolutionProject,
    built: BuiltContext,
    result: AiCoordinatorResult,
    previous: { health: ProjectHealth | null; blockers: Prisma.JsonValue } | null,
    insightId: string,
    created: Array<{ targetRef: string | null }>,
    actorUserId: string | null,
  ): Promise<void> {
    const problemPublicId = built.request.problem.public_id;
    const base = {
      projectId: project.id,
      roomId: project.roomId,
      problemPublicId,
      insightId,
      actorUserId,
    };

    // Alert only on something new and serious: health worsened into AT_RISK
    // or BLOCKED, or a potential blocker not seen in the last insight.
    const worsened =
      HEALTH_ORDER[result.health] >= HEALTH_ORDER.AT_RISK &&
      (!previous?.health || HEALTH_ORDER[result.health] > HEALTH_ORDER[previous.health]);
    const seen = storedFindings(previous?.blockers).map((b) => b.title.toLowerCase());
    const newBlocker = result.blockers.find((b) => !seen.includes(b.title.toLowerCase()));
    if (worsened || newBlocker) {
      this.events.publish({
        type: 'COORDINATOR_ALERT',
        ...base,
        headline: worsened
          ? `Project health is now ${HEALTH_LABEL[result.health]}: ${(result.healthReason || built.engine.reasons.join('; ')).slice(0, 240)}`
          : `Possible blocker noticed: ${newBlocker!.title}. Please confirm on the project page.`,
      });
    }

    if (created.length > 0) {
      const assigneeIds = created
        .map((q) => (q.targetRef ? built.assignees.get(q.targetRef) : null))
        .filter((id): id is string => typeof id === 'string');
      this.events.publish({
        type: 'COORDINATOR_QUESTIONS_ASKED',
        ...base,
        count: created.length,
        assigneeIds: [...new Set(assigneeIds)],
      });
    }
  }

  private toQuestionView(
    q: Prisma.CoordinatorQuestionGetPayload<{
      include: { answeredBy: { select: { fullName: true } } };
    }>,
    refs: Map<string, SourceReference>,
  ): CoordinatorQuestionView {
    return {
      id: q.id,
      question: q.question,
      category: q.category as QuestionCategory,
      status: q.status,
      target: q.targetRef ? (refs.get(q.targetRef) ?? null) : null,
      askedAt: q.askedAt.toISOString(),
      answer: q.answer,
      answeredAt: q.answeredAt?.toISOString() ?? null,
      answeredBy: q.answeredBy ? { name: q.answeredBy.fullName } : null,
    };
  }

  private async questionRefusal(pc: ProjectContext, questionId: string): Promise<never> {
    const q = await this.prisma.coordinatorQuestion.findFirst({
      where: { id: questionId, projectId: pc.project.id },
      select: { status: true },
    });
    if (!q) throw AppException.notFound('Question');
    throw AppException.conflict(`This question is already ${q.status.toLowerCase()}.`);
  }

  private requireOpen(pc: ProjectContext): void {
    if (
      pc.room.room.status !== 'OPEN' ||
      !PROJECT_EDITABLE_STATUSES.includes(pc.project.status)
    ) {
      throw AppException.conflict('This project is read-only.');
    }
  }

  private requireUpdater(pc: ProjectContext): void {
    this.requireOpen(pc);
    if (pc.room.side !== 'ORGANIZATION') {
      throw AppException.forbidden(
        'Progress updates are posted by the assigned organisation.',
      );
    }
  }

  private async cooldownRemaining(projectId: string): Promise<number> {
    const ttl = await this.redis.connection.ttl(cooldownKey(projectId)).catch(() => -2);
    return ttl > 0 ? ttl : 0;
  }
}

// ---------------------------------------------------------------- helpers

const cooldownKey = (projectId: string) => `coordinator:refresh:${projectId}`;

/** `CATEGORY|target` when the question is about a task or milestone. */
export function questionFingerprint(
  category: string,
  targetRef: string | null,
  question: string,
): string {
  if (targetRef) return `${category}|${targetRef}`;
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .sort()
    .join(' ');
  return `${category}|text:${createHash('sha256').update(words).digest('hex').slice(0, 24)}`;
}

function storedFindings(value: Prisma.JsonValue | null | undefined): StoredFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const f = item as Record<string, unknown>;
    if (typeof f.title !== 'string' || !Array.isArray(f.sourceRefs)) return [];
    return [
      {
        title: f.title,
        description: typeof f.description === 'string' ? f.description : f.title,
        sourceRefs: f.sourceRefs.filter((r): r is string => typeof r === 'string'),
        type: typeof f.type === 'string' ? f.type : undefined,
        severity: typeof f.severity === 'string' ? f.severity : undefined,
      },
    ];
  });
}

function findingRefs(value: Prisma.JsonValue | null | undefined): string[] {
  return storedFindings(value).flatMap((f) => f.sourceRefs);
}

function toUpdateView(
  row: Prisma.ProjectUpdateGetPayload<{
    include: {
      author: { select: { fullName: true } };
      authorOrganization: { select: { name: true; type: true } };
    };
  }>,
): ProjectUpdateView {
  return {
    id: row.id,
    summary: row.summary,
    completed: row.completed,
    current: row.current,
    blockers: row.blockers,
    nextSteps: row.nextSteps,
    source: row.source,
    author: {
      name: row.author.fullName,
      organizationName: row.authorOrganization.name,
      side: row.authorOrganization.type === 'GOVERNMENT' ? 'GOVERNMENT' : 'ORGANIZATION',
    },
    createdAt: row.createdAt.toISOString(),
  };
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = iso ? new Date(iso) : null;
  if (
    !createdAt ||
    Number.isNaN(createdAt.getTime()) ||
    !id ||
    !/^[0-9a-f-]{36}$/i.test(id)
  ) {
    throw AppException.badRequest('That page cursor is not valid.');
  }
  return { createdAt, id };
}
