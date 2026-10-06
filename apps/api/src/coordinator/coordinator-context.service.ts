import { Injectable } from '@nestjs/common';
import {
  isOverdue,
  milestoneStatus,
  projectToday,
  taskProgressPercent,
  type SourceReference,
} from '@samadhaan/shared';
import type { CoordinatorContext } from '../ai/dto/coordinator.dto.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ResolutionProject } from '../generated/prisma/client.js';
import { coarseArea } from '../problems/services/problem-discovery.service.js';
import { dateOut } from '../resolution/projects.service.js';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service.js';
import { evaluateHealth, type EngineResult } from './health-engine.js';

const DAY = 86_400_000;
const daysAgo = (date: Date, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY));
const firstName = (name: string) => name.split(' ')[0] ?? name;
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Events that mean nothing about progress: excluded from activity and staleness. */
const QUIET_EVENTS = ['PARTICIPANT_JOINED'] as const;

const EVENT_LABEL: Record<string, string> = {
  PROJECT_CREATED: 'Project created',
  PROJECT_UPDATED: 'Project details updated',
  PROJECT_STATUS_CHANGED: 'Project status changed',
  PROJECT_UPDATE_POSTED: 'Progress update posted',
  TASK_CREATED: 'Task created',
  TASK_UPDATED: 'Task updated',
  TASK_ASSIGNED: 'Task assigned',
  TASK_STATUS_CHANGED: 'Task status changed',
  MILESTONE_CREATED: 'Milestone created',
  MILESTONE_UPDATED: 'Milestone updated',
  MILESTONE_COMPLETED: 'Milestone completed',
  MILESTONE_REOPENED: 'Milestone reopened',
  ROOM_CREATED: 'Resolution room opened',
  MESSAGE_SENT: 'Message sent',
  MESSAGE_EDITED: 'Message edited',
  MESSAGE_DELETED: 'Message deleted',
  ATTACHMENT_ADDED: 'File added',
  ROOM_CLOSED: 'Room closed',
};

export interface HealthState {
  engine: EngineResult;
  /** Labels for the refs the engine produced. */
  refs: Map<string, SourceReference>;
  /** The latest change an insight could have seen — for staleness. */
  lastChangeAt: Date;
}

export interface BuiltContext extends HealthState {
  request: CoordinatorContext;
  knownRefs: Set<string>;
  /** Task and milestone refs — what a question may be about. */
  targetRefs: Set<string>;
  /** Task ref → its assignee's user id, for question notifications. */
  assignees: Map<string, string | null>;
}

/**
 * Builds the coordinator's view of a project (Prompt 19).
 *
 * Only what the coordinator needs, bounded by configuration: the problem, the
 * project, every open task, a few recently completed ones, milestones, recent
 * structured events, recent room messages, structured updates and question
 * history. No emails, phones or ids beyond refs; first names only; no
 * government internal notes or allocation reasons — those never leave their
 * own screens.
 */
@Injectable()
export class CoordinatorContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly knowledge: KnowledgeRetrievalService,
  ) {}

  /** The live, deterministic part — cheap enough for every page view. */
  async health(project: ResolutionProject): Promise<HealthState> {
    const now = new Date();
    const today = projectToday(now);
    const [tasks, milestones, lastEvent, lastUpdate, lastAnswer] = await Promise.all([
      this.prisma.resolutionTask.findMany({
        where: {
          projectId: project.id,
          status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED'] },
        },
        select: { id: true, title: true, status: true, priority: true, dueDate: true },
        // Deterministic order: the same project always yields the same signals.
        orderBy: [
          { dueDate: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        take: 500,
      }),
      this.prisma.resolutionMilestone.findMany({
        where: { projectId: project.id },
        select: { id: true, title: true, dueDate: true, completedAt: true },
        orderBy: [
          { dueDate: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        take: 200,
      }),
      this.prisma.resolutionRoomEvent.findFirst({
        where: { roomId: project.roomId, type: { notIn: [...QUIET_EVENTS] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.projectUpdate.findFirst({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.coordinatorQuestion.findFirst({
        where: { projectId: project.id, answeredAt: { not: null } },
        orderBy: { answeredAt: 'desc' },
        select: { answeredAt: true },
      }),
    ]);

    const activity = [lastEvent?.createdAt, lastUpdate?.createdAt].filter(
      (date): date is Date => date !== undefined,
    );
    const lastActivityAt = activity.length
      ? new Date(Math.max(...activity.map((d) => d.getTime())))
      : null;

    const engine = evaluateHealth(
      {
        today,
        now,
        project: {
          status: project.status,
          targetDate: dateOut(project.targetDate),
          createdAt: project.createdAt,
          lastActivityAt,
        },
        tasks: tasks.map((task) => ({ ...task, dueDate: dateOut(task.dueDate) })),
        milestones: milestones.map((m) => ({
          id: m.id,
          title: m.title,
          dueDate: dateOut(m.dueDate),
          completed: m.completedAt !== null,
        })),
      },
      this.config.coordinator.health,
    );

    const refs = new Map<string, SourceReference>();
    for (const task of tasks)
      refs.set(`task:${task.id}`, taskRef(project.roomId, task.id, task.title));
    for (const m of milestones)
      refs.set(`milestone:${m.id}`, milestoneRef(project.roomId, m.id, m.title));
    for (const signal of engine.signals) {
      const source = signal.sourceRef ? refs.get(signal.sourceRef) : undefined;
      refs.set(signal.ref, {
        kind: 'signal',
        id: signal.ref,
        label: signal.title,
        href: source?.href ?? `/resolution/${project.roomId}/project`,
      });
    }

    const changes = [
      lastActivityAt,
      lastAnswer?.answeredAt ?? null,
      project.updatedAt,
    ].filter((date): date is Date => date !== null);
    return {
      engine,
      refs,
      lastChangeAt: new Date(Math.max(...changes.map((d) => d.getTime()))),
    };
  }

  /** The full context for an analysis. */
  async build(project: ResolutionProject): Promise<BuiltContext> {
    const now = new Date();
    const today = projectToday(now);
    const limits = this.config.coordinator.limits;
    const state = await this.health(project);

    const [
      problem,
      openTasks,
      completedTasks,
      counts,
      milestones,
      events,
      messages,
      updates,
      answered,
      open,
    ] = await Promise.all([
      this.prisma.problem.findUniqueOrThrow({
        where: { id: project.problemId },
        select: {
          publicId: true,
          title: true,
          description: true,
          category: true,
          subcategory: true,
          severity: true,
          urgency: true,
          address: true,
          city: true,
          aiAnalyses: {
            where: { analysisType: 'INITIAL_ANALYSIS', processingStatus: 'COMPLETED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { summary: true },
          },
        },
      }),
      this.prisma.resolutionTask.findMany({
        where: {
          projectId: project.id,
          status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED'] },
        },
        include: { assignedTo: { select: { id: true, fullName: true } } },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: 150,
      }),
      this.prisma.resolutionTask.findMany({
        where: { projectId: project.id, status: 'COMPLETED' },
        include: { assignedTo: { select: { id: true, fullName: true } } },
        orderBy: { completedAt: 'desc' },
        take: limits.completedTasks,
      }),
      this.prisma.resolutionTask.groupBy({
        by: ['status'],
        where: { projectId: project.id },
        _count: { _all: true },
      }),
      this.prisma.resolutionMilestone.findMany({
        where: { projectId: project.id },
        include: { tasks: { select: { status: true } } },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }],
        take: 50,
      }),
      this.prisma.resolutionRoomEvent.findMany({
        // Structured activity; messages are sent separately as text.
        where: {
          roomId: project.roomId,
          type: {
            notIn: [
              'PARTICIPANT_JOINED',
              'MESSAGE_SENT',
              'MESSAGE_EDITED',
              'MESSAGE_DELETED',
            ],
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limits.events,
      }),
      this.prisma.resolutionMessage.findMany({
        where: { roomId: project.roomId, deletedAt: null },
        include: { author: { select: { fullName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limits.messages,
      }),
      this.prisma.projectUpdate.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
        take: limits.updates,
      }),
      this.prisma.coordinatorQuestion.findMany({
        where: { projectId: project.id, status: 'ANSWERED' },
        orderBy: { answeredAt: 'desc' },
        take: limits.answeredQuestions,
      }),
      this.prisma.coordinatorQuestion.findMany({
        where: { projectId: project.id, status: 'OPEN' },
        orderBy: { askedAt: 'desc' },
        take: 20,
      }),
    ]);

    const n = (status: string) =>
      counts.find((c) => c.status === status)?._count._all ?? 0;
    const total = counts.reduce((sum, c) => sum + c._count._all, 0);
    const refs = new Map(state.refs);
    const assignees = new Map<string, string | null>();

    const tasks = [...openTasks, ...completedTasks].map((task) => {
      const ref = `task:${task.id}`;
      const due = dateOut(task.dueDate);
      refs.set(ref, taskRef(project.roomId, task.id, task.title));
      assignees.set(ref, task.assignedToId);
      const overdue = isOverdue(due, task.status, today);
      return {
        ref,
        title: task.title,
        status: task.status,
        priority: task.priority,
        assignee: task.assignedTo ? firstName(task.assignedTo.fullName) : null,
        due_date: due,
        overdue,
        days_overdue:
          overdue && due ? Math.round((Date.parse(today) - Date.parse(due)) / DAY) : null,
        milestone_ref: task.milestoneId ? `milestone:${task.milestoneId}` : null,
        days_since_update: daysAgo(task.updatedAt, now),
      };
    });

    const milestoneContext = milestones.map((m) => {
      const ref = `milestone:${m.id}`;
      refs.set(ref, milestoneRef(project.roomId, m.id, m.title));
      const done = m.tasks.filter((t) => t.status === 'COMPLETED').length;
      const openCount = m.tasks.filter((t) =>
        ['TODO', 'IN_PROGRESS', 'BLOCKED'].includes(t.status),
      ).length;
      return {
        ref,
        title: m.title,
        status: milestoneStatus({
          completedAt: m.completedAt?.toISOString() ?? null,
          dueDate: dateOut(m.dueDate),
          workStarted: m.tasks.some((t) =>
            ['IN_PROGRESS', 'BLOCKED', 'COMPLETED'].includes(t.status),
          ),
          today,
        }),
        due_date: dateOut(m.dueDate),
        open_tasks: openCount,
        completed_tasks: done,
      };
    });

    const eventContext = events.map((event) => {
      const meta = (event.metadata ?? {}) as Record<string, unknown>;
      const text = (key: string) =>
        typeof meta[key] === 'string' ? clip(meta[key] as string, 160) : null;
      const ref = `event:${event.id}`;
      const label = EVENT_LABEL[event.type] ?? event.type;
      refs.set(ref, {
        kind: 'event',
        id: event.id,
        label: `${label}${text('subject') ? `: ${text('subject')}` : ''} (${shortDate(event.createdAt)})`,
        href: `/resolution/${project.roomId}/project#activity`,
      });
      const from = text('from');
      const to = text('to');
      return {
        ref,
        kind: event.type,
        subject: text('subject'),
        detail: from && to ? `${from} → ${to}` : (text('detail') ?? text('reason')),
        days_ago: daysAgo(event.createdAt, now),
      };
    });

    const messageContext = messages.map((message) => {
      const ref = `message:${message.id}`;
      refs.set(ref, {
        kind: 'message',
        id: message.id,
        label: `Message from ${firstName(message.author.fullName)}, ${shortDate(message.createdAt)}`,
        href: `/resolution/${project.roomId}#message-${message.id}`,
      });
      return {
        ref,
        side: message.authorSide,
        author: firstName(message.author.fullName),
        days_ago: daysAgo(message.createdAt, now),
        text: clip(message.body, 800),
      };
    });

    const updateContext = updates.map((update) => {
      const ref = `update:${update.id}`;
      refs.set(ref, {
        kind: 'update',
        id: update.id,
        label: `Progress update, ${shortDate(update.createdAt)}`,
        href: `/resolution/${project.roomId}/project#update-${update.id}`,
      });
      return {
        ref,
        days_ago: daysAgo(update.createdAt, now),
        summary: clip(update.summary, 400),
        completed: update.completed.slice(0, 8),
        current: update.current.slice(0, 8),
        blockers: update.blockers.slice(0, 8),
        next_steps: update.nextSteps.slice(0, 8),
      };
    });

    const questionRef = (q: { id: string; question: string }) => {
      const ref = `question:${q.id}`;
      refs.set(ref, {
        kind: 'question',
        id: q.id,
        label: clip(q.question, 120),
        href: `/resolution/${project.roomId}/project#coordinator`,
      });
      return ref;
    };

    const request: CoordinatorContext = {
      project_id: project.id,
      today,
      problem: {
        public_id: problem.publicId,
        title: problem.title,
        description: clip(problem.description, 1500),
        category: problem.category,
        subcategory: problem.subcategory,
        severity: problem.severity,
        urgency: problem.urgency,
        area: coarseArea(problem.address, problem.city),
        ai_summary: problem.aiAnalyses[0]?.summary ?? null,
      },
      project: {
        name: project.name,
        status: project.status,
        start_date: dateOut(project.startDate),
        target_date: dateOut(project.targetDate),
        task_progress: taskProgressPercent({
          total,
          completed: n('COMPLETED'),
          cancelled: n('CANCELLED'),
        }),
        open_tasks: n('TODO') + n('IN_PROGRESS') + n('BLOCKED'),
        completed_tasks: n('COMPLETED'),
        cancelled_tasks: n('CANCELLED'),
      },
      tasks,
      milestones: milestoneContext,
      events: eventContext,
      messages: messageContext,
      updates: updateContext,
      answered_questions: answered.map((q) => ({
        ref: questionRef(q),
        question: q.question,
        answer: q.answer,
        days_ago: daysAgo(q.answeredAt ?? q.askedAt, now),
      })),
      open_questions: open.map((q) => ({
        ref: questionRef(q),
        question: q.question,
        answer: null,
        days_ago: daysAgo(q.askedAt, now),
      })),
      signals: state.engine.signals.map((s) => ({
        ref: s.ref,
        code: s.code,
        severity: s.severity,
        title: s.title,
        source_ref: s.sourceRef,
      })),
      knowledge: await this.retrieveKnowledge(project, problem, openTasks, refs),
      baseline: { health: state.engine.health, reasons: state.engine.reasons },
    };

    // Open questions are context only — a finding may not cite them.
    const knownRefs = new Set(
      [...refs.keys()].filter((ref) => !open.some((q) => ref === `question:${q.id}`)),
    );
    const targetRefs = new Set(
      [...refs.keys()].filter((r) => r.startsWith('task:') || r.startsWith('milestone:')),
    );
    return { ...state, refs, request, knownRefs, targetRefs, assignees };
  }

  /**
   * Guidance for the coordinator (Prompt 20): retrieved under a scope of
   * PUBLIC sources and this project's own — knowledge every participant may
   * read, so nothing private reaches an insight both sides see. Evidence, not
   * authority. A retrieval failure leaves the section empty; the coordinator
   * still runs.
   */
  private async retrieveKnowledge(
    project: ResolutionProject,
    problem: {
      title: string;
      category: string;
      subcategory: string | null;
      city: string | null;
    },
    openTasks: Array<{ title: string }>,
    refs: Map<string, SourceReference>,
  ): Promise<CoordinatorContext['knowledge']> {
    const topK = this.config.rag.coordinatorTopK;
    if (!this.config.rag.enabled || topK === 0) return [];
    try {
      const query = [
        problem.title,
        problem.category.replace('_', ' '),
        problem.subcategory,
        ...openTasks.slice(0, 3).map((t) => t.title),
      ]
        .filter(Boolean)
        .join('. ');
      const result = await this.knowledge.retrieve({
        semanticQuery: `What procedure applies? ${query}`,
        keywordQuery: query,
        scope: {
          userId: '00000000-0000-0000-0000-000000000000',
          officeIds: [],
          organizationIds: [],
          projectId: project.id,
          only: ['PUBLIC', 'PROJECT'],
        },
        context: { kind: 'PROJECT', category: problem.category, city: problem.city },
        topK,
      });
      return result.passages.map((p) => {
        const ref = `knowledge:${p.chunkId}`;
        refs.set(ref, {
          kind: 'knowledge',
          id: p.chunkId,
          label: `${p.title}${p.sectionTitle ? ` — ${p.sectionTitle}` : ''}`,
          href: `/knowledge/sources/${p.sourceId}#chunk-${p.chunkId}`,
        });
        return {
          ref,
          title: p.title,
          section: p.sectionTitle,
          excerpt: clip(p.content, 1500),
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Resolves refs stored on an insight into current labels and links.
   * Refs that no longer resolve — a deleted message, a task from elsewhere —
   * are dropped, so nothing hidden since resurfaces through an old insight.
   */
  async resolve(
    project: ResolutionProject,
    refs: string[],
    known: Map<string, SourceReference>,
  ) {
    const wanted = [...new Set(refs)].filter((ref) => !known.has(ref));
    const ids = (kind: string) =>
      wanted
        .filter((r) => r.startsWith(`${kind}:`))
        .map((r) => r.slice(kind.length + 1))
        .filter(isUuid);
    const [tasks, milestones, messages, events, updates, questions] = await Promise.all([
      this.prisma.resolutionTask.findMany({
        where: { id: { in: ids('task') }, projectId: project.id },
        select: { id: true, title: true },
      }),
      this.prisma.resolutionMilestone.findMany({
        where: { id: { in: ids('milestone') }, projectId: project.id },
        select: { id: true, title: true },
      }),
      this.prisma.resolutionMessage.findMany({
        where: { id: { in: ids('message') }, roomId: project.roomId, deletedAt: null },
        select: { id: true, createdAt: true, author: { select: { fullName: true } } },
      }),
      this.prisma.resolutionRoomEvent.findMany({
        where: { id: { in: ids('event') }, roomId: project.roomId },
        select: { id: true, type: true, createdAt: true, metadata: true },
      }),
      this.prisma.projectUpdate.findMany({
        where: { id: { in: ids('update') }, projectId: project.id },
        select: { id: true, createdAt: true },
      }),
      this.prisma.coordinatorQuestion.findMany({
        where: { id: { in: ids('question') }, projectId: project.id },
        select: { id: true, question: true },
      }),
    ]);
    const knowledgeChunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        id: { in: ids('knowledge') },
        source: {
          status: 'COMPLETED',
          OR: [
            { visibility: 'PUBLIC' },
            { visibility: 'PROJECT', projectId: project.id },
          ],
        },
      },
      select: {
        id: true,
        sectionTitle: true,
        sourceId: true,
        source: { select: { title: true } },
      },
    });
    const map = new Map(known);
    for (const k of knowledgeChunks) {
      map.set(`knowledge:${k.id}`, {
        kind: 'knowledge',
        id: k.id,
        label: `${k.source.title}${k.sectionTitle ? ` — ${k.sectionTitle}` : ''}`,
        href: `/knowledge/sources/${k.sourceId}#chunk-${k.id}`,
      });
    }
    for (const t of tasks)
      map.set(`task:${t.id}`, taskRef(project.roomId, t.id, t.title));
    for (const m of milestones)
      map.set(`milestone:${m.id}`, milestoneRef(project.roomId, m.id, m.title));
    for (const m of messages) {
      map.set(`message:${m.id}`, {
        kind: 'message',
        id: m.id,
        label: `Message from ${firstName(m.author.fullName)}, ${shortDate(m.createdAt)}`,
        href: `/resolution/${project.roomId}#message-${m.id}`,
      });
    }
    for (const e of events) {
      const subject = (e.metadata as Record<string, unknown> | null)?.subject;
      map.set(`event:${e.id}`, {
        kind: 'event',
        id: e.id,
        label: `${EVENT_LABEL[e.type] ?? e.type}${typeof subject === 'string' ? `: ${clip(subject, 80)}` : ''} (${shortDate(e.createdAt)})`,
        href: `/resolution/${project.roomId}/project#activity`,
      });
    }
    for (const u of updates) {
      map.set(`update:${u.id}`, {
        kind: 'update',
        id: u.id,
        label: `Progress update, ${shortDate(u.createdAt)}`,
        href: `/resolution/${project.roomId}/project#update-${u.id}`,
      });
    }
    for (const q of questions) {
      map.set(`question:${q.id}`, {
        kind: 'question',
        id: q.id,
        label: clip(q.question, 120),
        href: `/resolution/${project.roomId}/project#coordinator`,
      });
    }
    return map;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function taskRef(roomId: string, id: string, title: string): SourceReference {
  return {
    kind: 'task',
    id,
    label: title,
    href: `/resolution/${roomId}/project#task-${id}`,
  };
}

function milestoneRef(roomId: string, id: string, title: string): SourceReference {
  return {
    kind: 'milestone',
    id,
    label: title,
    href: `/resolution/${roomId}/project#milestone-${id}`,
  };
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}
