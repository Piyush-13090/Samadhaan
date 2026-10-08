import { Injectable } from '@nestjs/common';
import {
  OPEN_TASK_STATUSES,
  PROJECT_EDITABLE_STATUSES,
  PROJECT_MANAGER_ROLES,
  PROJECT_TRANSITIONS,
  TASK_ASSIGNEE_TRANSITIONS,
  TASK_MAX_ATTACHMENTS,
  TASK_TRANSITIONS,
  canTransitionProject,
  canTransitionTask,
  isOverdue,
  milestoneProgressPercent,
  milestoneStatus,
  projectToday,
  taskProgressPercent,
  type MilestoneView,
  type ProjectActivityEntry,
  type ProjectActivityKind,
  type ProjectActivityPage,
  type ProjectAssignee,
  type ProjectOverview,
  type ProjectStatus,
  type ProjectSummary,
  type ProjectView,
  type TaskCounts,
  type TaskPage,
  type TaskPerson,
  type TaskPriority,
  type TaskStatus,
  type TaskView,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import { Prisma, type ResolutionProject } from '../generated/prisma/client.js';
import { coarseArea } from '../problems/services/problem-discovery.service.js';
import {
  ResolutionAccessService,
  type RoomContext,
} from './resolution-access.service.js';
import { toAttachmentView } from './resolution-rooms.service.js';

/** A project, proven accessible, with what the caller may do in it. */
export interface ProjectContext {
  project: ResolutionProject;
  room: RoomContext;
  /** OWNER/ADMIN of the assigned organisation. */
  canManage: boolean;
  /** Project live (PLANNED/ACTIVE/PAUSED) and room open. */
  isEditable: boolean;
}

const PERSON = { select: { id: true, fullName: true, avatarUrl: true } } as const;

const TASK_INCLUDE = {
  assignedTo: PERSON,
  completedBy: PERSON,
  createdBy: PERSON,
  milestone: { select: { id: true, title: true } },
  attachments: {
    include: {
      attachment: {
        include: {
          uploadedBy: { select: { id: true, fullName: true } },
          message: { select: { deletedAt: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ResolutionTaskInclude;

type TaskRow = Prisma.ResolutionTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

const PROJECT_EVENT_TYPES = [
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_STATUS_CHANGED',
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_ASSIGNED',
  'TASK_STATUS_CHANGED',
  'MILESTONE_CREATED',
  'MILESTONE_UPDATED',
  'MILESTONE_COMPLETED',
  'MILESTONE_REOPENED',
] as const;

export interface TaskFilters {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  /** A user id, `me`, or `unassigned`. */
  assignee?: string;
  milestoneId?: string;
  overdue?: boolean;
  dueBefore?: string;
  dueAfter?: string;
  page: number;
  limit: number;
}

/**
 * Resolution projects (Prompt 18): the deterministic plan inside a room.
 *
 * Access rides on the room's: whoever may enter the room may see its project,
 * and nobody else (404). Within it:
 *
 *   assigned organisation OWNER/ADMIN  manage everything
 *   assigned organisation MEMBER       move their own tasks (start, block, complete)
 *   government officials               read; edit the project's name and description
 *
 * Every state change is a conditional update on the state the caller saw, so
 * two people acting at once cannot both win; the loser gets 409.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ResolutionAccessService,
    private readonly events: DomainEventBus,
  ) {}

  // ================================================================ access

  async resolve(projectId: string, user: RequestUser): Promise<ProjectContext> {
    const found = await this.prisma.resolutionProject.findUnique({
      where: { id: projectId },
    });
    if (!found) throw AppException.notFound('Project');
    return this.contextFor(found, user);
  }

  async resolveByRoom(roomId: string, user: RequestUser): Promise<ProjectContext> {
    const room = await this.access.resolve(roomId, user);
    const project = await this.prisma.resolutionProject.findUnique({ where: { roomId } });
    if (!project) throw AppException.notFound('Project');
    return this.build(project, room);
  }

  private async contextFor(
    project: ResolutionProject,
    user: RequestUser,
  ): Promise<ProjectContext> {
    let room: RoomContext;
    try {
      room = await this.access.resolve(project.roomId, user);
    } catch (error) {
      // Same answer as for a project that does not exist.
      if (error instanceof AppException && error.getStatus() === 404) {
        throw AppException.notFound('Project');
      }
      throw error;
    }
    return this.build(project, room);
  }

  private build(project: ResolutionProject, room: RoomContext): ProjectContext {
    return {
      project,
      room,
      canManage:
        room.side === 'ORGANIZATION' &&
        (PROJECT_MANAGER_ROLES as readonly string[]).includes(
          room.membership.membershipRole,
        ),
      isEditable:
        PROJECT_EDITABLE_STATUSES.includes(project.status) && room.room.status === 'OPEN',
    };
  }

  private requireManager(context: ProjectContext): void {
    if (!context.canManage) {
      throw AppException.forbidden(
        context.room.side === 'GOVERNMENT'
          ? 'The assigned organisation manages its project plan. Use the resolution room to discuss it.'
          : 'Only owners and admins of your organisation can change the project plan.',
      );
    }
  }

  private requireEditable(context: ProjectContext): void {
    if (context.room.room.status !== 'OPEN') {
      throw AppException.conflict(
        'The resolution room is closed, so its project is read-only.',
      );
    }
    if (!PROJECT_EDITABLE_STATUSES.includes(context.project.status)) {
      throw AppException.conflict(
        `This project is ${context.project.status.toLowerCase()}, so it can no longer change.`,
      );
    }
  }

  // ================================================================ project

  async view(context: ProjectContext, user: RequestUser): Promise<ProjectView> {
    const { project, room } = context;
    const [problem, overviews] = await Promise.all([
      this.prisma.problem.findUniqueOrThrow({
        where: { id: project.problemId },
        select: {
          publicId: true,
          title: true,
          status: true,
          category: true,
          subcategory: true,
          address: true,
          city: true,
        },
      }),
      this.overviews([project.id]),
    ]);

    return {
      id: project.id,
      roomId: project.roomId,
      name: project.name,
      description: project.description,
      status: project.status,
      startDate: dateOut(project.startDate),
      targetDate: dateOut(project.targetDate),
      startedAt: project.startedAt?.toISOString() ?? null,
      completedAt: project.completedAt?.toISOString() ?? null,
      cancelledAt: project.cancelledAt?.toISOString() ?? null,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      version: project.version,
      problem: {
        publicId: problem.publicId,
        title: problem.title,
        status: problem.status,
        category: problem.category,
        subcategory: problem.subcategory,
        area: coarseArea(problem.address, problem.city),
      },
      government: { name: room.room.governmentOrganization.name },
      organization: {
        name: room.room.assignedOrganization.name,
        slug: room.room.assignedOrganization.slug,
      },
      overview: overviews.get(project.id) ?? emptyOverview(),
      viewer: { userId: user.id, side: room.side, role: room.membership.membershipRole },
      permissions: {
        canManage: context.canManage,
        canUpdateOwnTasks: room.side === 'ORGANIZATION',
        isEditable: context.isEditable,
        // COMPLETED is reached only through resolution verification (Prompt 22).
        allowedTransitions:
          context.canManage && room.room.status === 'OPEN'
            ? PROJECT_TRANSITIONS[project.status].filter((s) => s !== 'COMPLETED')
            : [],
      },
      today: projectToday(),
    };
  }

  /**
   * Name and description: either side may edit (the problem belongs to the
   * office; the plan to the organisation). Dates: the organisation's managers.
   */
  async update(
    context: ProjectContext,
    input: {
      version: number;
      name?: string;
      description?: string | null;
      startDate?: string | null;
      targetDate?: string | null;
    },
    user: RequestUser,
  ): Promise<void> {
    this.requireEditable(context);
    const touchesDates = input.startDate !== undefined || input.targetDate !== undefined;
    if (touchesDates) this.requireManager(context);
    if (!context.canManage && context.room.side !== 'GOVERNMENT')
      this.requireManager(context);

    const { project } = context;
    const startDate =
      input.startDate !== undefined ? input.startDate : dateOut(project.startDate);
    const targetDate =
      input.targetDate !== undefined ? input.targetDate : dateOut(project.targetDate);
    if (startDate && targetDate && targetDate < startDate) {
      throw AppException.badRequest('The target date cannot be before the start date.');
    }
    if (input.startDate) await this.assertNoDatesBefore(project.id, input.startDate);

    const changed = Object.entries(input)
      .filter(([key, value]) => key !== 'version' && value !== undefined)
      .map(([key]) => key);
    if (changed.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.resolutionProject.updateMany({
        where: { id: project.id, version: input.version },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.startDate !== undefined
            ? { startDate: dateIn(input.startDate) }
            : {}),
          ...(input.targetDate !== undefined
            ? { targetDate: dateIn(input.targetDate) }
            : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw staleConflict('project');
      await this.event(tx, context, user, 'PROJECT_UPDATED', {
        subject: input.name ?? project.name,
        fields: changed,
      });
    });
  }

  /** The project state machine. Only the organisation's managers move it. */
  async transition(
    context: ProjectContext,
    to: ProjectStatus,
    reason: string | null,
    user: RequestUser,
  ): Promise<void> {
    this.requireManager(context);
    if (context.room.room.status !== 'OPEN') {
      throw AppException.conflict(
        'The resolution room is closed, so its project is read-only.',
      );
    }
    const { project } = context;
    if (!canTransitionProject(project.status, to)) {
      throw AppException.conflict(
        `A ${project.status.toLowerCase()} project cannot become ${to.toLowerCase()}.`,
      );
    }
    if (to === 'CANCELLED' && !reason) {
      throw AppException.badRequest('Give a reason for cancelling the project.');
    }
    // Prompt 22: completion is a government verification decision. The
    // organisation submits completion evidence; the allocating office's
    // approval completes the project and resolves the problem together.
    if (to === 'COMPLETED') {
      throw AppException.conflict(
        'Submit completion evidence and request verification. The project is completed when the government office approves the resolution.',
      );
    }
    await this.applyTransition(context, project.status, to, reason, user);
  }

  /**
   * ACTIVE → COMPLETED inside the caller's transaction, for an approved
   * resolution verification only (Prompt 22). `context` is the approving
   * official's (government side). Returns the publisher to run after commit.
   */
  async completeOnVerification(
    context: ProjectContext,
    user: RequestUser,
    tx: Prisma.TransactionClient,
  ): Promise<() => Promise<void>> {
    if (context.project.status !== 'ACTIVE') {
      throw AppException.conflict('Only an active project can be completed.');
    }
    const open = await tx.resolutionTask.count({
      where: { projectId: context.project.id, status: { in: [...OPEN_TASK_STATUSES] } },
    });
    if (open > 0) {
      throw AppException.conflict(
        `The project still has ${open} open ${open === 1 ? 'task' : 'tasks'}. The organisation must complete or cancel ${open === 1 ? 'it' : 'them'} first.`,
      );
    }
    return this.applyTransition(
      context,
      'ACTIVE',
      'COMPLETED',
      'Resolution verified by the government office.',
      user,
      tx,
    );
  }

  private async applyTransition(
    context: ProjectContext,
    from: ProjectStatus,
    to: ProjectStatus,
    reason: string | null,
    user: RequestUser,
    tx?: Prisma.TransactionClient,
  ): Promise<() => Promise<void>> {
    const now = new Date();
    const run = async (client: Prisma.TransactionClient) => {
      const { count } = await client.resolutionProject.updateMany({
        where: { id: context.project.id, status: from },
        data: {
          status: to,
          ...(to === 'ACTIVE' && !context.project.startedAt ? { startedAt: now } : {}),
          ...(to === 'ACTIVE' && !context.project.startDate
            ? { startDate: dateIn(projectToday(now)) }
            : {}),
          ...(to === 'COMPLETED' ? { completedAt: now } : {}),
          ...(to === 'CANCELLED' ? { cancelledAt: now } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw staleConflict('project');

      const event = await this.event(client, context, user, 'PROJECT_STATUS_CHANGED', {
        subject: context.project.name,
        from,
        to,
        ...(reason ? { reason } : {}),
      });
      await client.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'RESOLUTION_PROJECT_STATUS_CHANGED',
          entityType: 'ResolutionProject',
          entityId: context.project.id,
          metadata: {
            from,
            to,
            reason,
            roomId: context.project.roomId,
            organizationId: context.room.organization.id,
          },
        },
      });
      return event.id;
    };

    const changeId = tx ? await run(tx) : await this.prisma.$transaction(run);
    // Publishing inside a caller's transaction would announce a change that
    // may yet roll back, so within one the caller runs this after commit.
    const publish = () =>
      this.publishStatus(context, from, to, user, changeId).catch(() => undefined);
    if (!tx) void publish();
    return publish;
  }

  private async publishStatus(
    context: ProjectContext,
    from: ProjectStatus,
    to: ProjectStatus,
    user: RequestUser,
    changeId: string,
  ): Promise<void> {
    const problem = await this.problemRef(context.project.problemId);
    this.events.publish({
      type: 'PROJECT_STATUS_CHANGED',
      projectId: context.project.id,
      roomId: context.project.roomId,
      problemPublicId: problem.publicId,
      from,
      to,
      actorUserId: user.id,
      actorOrganizationName: context.room.organization.name,
      changeId,
    });
  }

  // ================================================================= tasks

  async tasks(
    context: ProjectContext,
    filters: TaskFilters,
    user: RequestUser,
  ): Promise<TaskPage> {
    const today = projectToday();
    const where: Prisma.ResolutionTaskWhereInput = {
      projectId: context.project.id,
      ...(filters.status?.length ? { status: { in: filters.status } } : {}),
      ...(filters.priority?.length ? { priority: { in: filters.priority } } : {}),
      ...(filters.milestoneId ? { milestoneId: filters.milestoneId } : {}),
      ...(filters.assignee === 'unassigned'
        ? { assignedToId: null }
        : filters.assignee
          ? { assignedToId: filters.assignee === 'me' ? user.id : filters.assignee }
          : {}),
      ...(filters.overdue
        ? { dueDate: { lt: day(today) }, status: { in: [...OPEN_TASK_STATUSES] } }
        : {}),
      ...(filters.dueBefore || filters.dueAfter
        ? {
            AND: [
              ...(filters.dueBefore
                ? [{ dueDate: { lte: day(filters.dueBefore) } }]
                : []),
              ...(filters.dueAfter ? [{ dueDate: { gte: day(filters.dueAfter) } }] : []),
            ],
          }
        : {}),
    };

    const [rows, totalCount] = await Promise.all([
      this.prisma.resolutionTask.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: [
          { dueDate: { sort: 'asc', nulls: 'last' } },
          { priority: 'desc' },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.resolutionTask.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toTaskView(row, context, user, today)),
      page: filters.page,
      limit: filters.limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / filters.limit)),
    };
  }

  async task(
    context: ProjectContext,
    taskId: string,
    user: RequestUser,
  ): Promise<TaskView> {
    const row = await this.prisma.resolutionTask.findFirst({
      where: { id: taskId, projectId: context.project.id },
      include: TASK_INCLUDE,
    });
    if (!row) throw AppException.notFound('Task');
    return this.toTaskView(row, context, user, projectToday());
  }

  async createTask(
    context: ProjectContext,
    input: {
      title: string;
      description: string | null;
      priority: TaskPriority;
      assignedToId: string | null;
      dueDate: string | null;
      milestoneId: string | null;
    },
    user: RequestUser,
  ): Promise<TaskView> {
    this.requireManager(context);
    this.requireEditable(context);
    await this.validateTaskRefs(context, input);

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.resolutionTask.create({
        data: {
          projectId: context.project.id,
          title: input.title,
          description: input.description,
          priority: input.priority,
          assignedToId: input.assignedToId,
          dueDate: dateIn(input.dueDate),
          milestoneId: input.milestoneId,
          createdById: user.id,
        },
        include: TASK_INCLUDE,
      });
      await this.event(tx, context, user, 'TASK_CREATED', {
        taskId: created.id,
        subject: created.title,
      });
      if (created.assignedTo) {
        await this.event(tx, context, user, 'TASK_ASSIGNED', {
          taskId: created.id,
          subject: created.title,
          detail: created.assignedTo.fullName,
        });
      }
      return created;
    });

    if (task.assignedToId) await this.publishAssigned(context, task, user);
    return this.toTaskView(task, context, user, projectToday());
  }

  /** Details: managers only, open tasks only, on the version they read. */
  async updateTask(
    context: ProjectContext,
    taskId: string,
    input: {
      version: number;
      title?: string;
      description?: string | null;
      priority?: TaskPriority;
      assignedToId?: string | null;
      dueDate?: string | null;
      milestoneId?: string | null;
    },
    user: RequestUser,
  ): Promise<TaskView> {
    this.requireManager(context);
    this.requireEditable(context);
    const current = await this.findTask(context, taskId);
    if (!OPEN_TASK_STATUSES.includes(current.status)) {
      throw AppException.conflict(
        `A ${current.status.toLowerCase()} task cannot be edited.`,
      );
    }
    await this.validateTaskRefs(context, {
      assignedToId: input.assignedToId ?? null,
      dueDate: input.dueDate ?? null,
      milestoneId: input.milestoneId ?? null,
    });

    const reassigned =
      input.assignedToId !== undefined && input.assignedToId !== current.assignedToId;
    const fields = Object.entries(input)
      .filter(([key, value]) => key !== 'version' && value !== undefined)
      .map(([key]) => key);

    const task = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.resolutionTask.updateMany({
        where: { id: taskId, projectId: context.project.id, version: input.version },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.assignedToId !== undefined
            ? { assignedToId: input.assignedToId }
            : {}),
          ...(input.dueDate !== undefined ? { dueDate: dateIn(input.dueDate) } : {}),
          ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw staleConflict('task');
      const updated = await tx.resolutionTask.findUniqueOrThrow({
        where: { id: taskId },
        include: TASK_INCLUDE,
      });
      if (fields.some((field) => field !== 'assignedToId')) {
        await this.event(tx, context, user, 'TASK_UPDATED', {
          taskId,
          subject: updated.title,
          fields,
        });
      }
      if (reassigned) {
        await this.event(tx, context, user, 'TASK_ASSIGNED', {
          taskId,
          subject: updated.title,
          detail: updated.assignedTo?.fullName ?? 'nobody',
        });
      }
      return updated;
    });

    if (reassigned && task.assignedToId) await this.publishAssigned(context, task, user);
    return this.toTaskView(task, context, user, projectToday());
  }

  /**
   * The task state machine. Managers may make any allowed move; an assignee
   * may start, block and complete their own task. Conditional on the status
   * the caller saw: two people completing at once — one wins, one gets 409.
   * Starting work on a PLANNED project starts the project, in the same
   * transaction.
   */
  async transitionTask(
    context: ProjectContext,
    taskId: string,
    to: TaskStatus,
    user: RequestUser,
  ): Promise<TaskView> {
    this.requireEditable(context);
    const current = await this.findTask(context, taskId);
    const allowed = this.allowedTaskTransitions(context, current, user);
    if (!allowed.includes(to)) {
      if (!canTransitionTask(current.status, to)) {
        throw AppException.conflict(
          `A ${label(current.status)} task cannot become ${label(to)}.`,
        );
      }
      if (
        context.project.status === 'PAUSED' &&
        (to === 'IN_PROGRESS' || to === 'COMPLETED')
      ) {
        throw AppException.conflict(
          'The project is paused. Resume it before continuing work.',
        );
      }
      throw AppException.forbidden(
        context.room.side === 'GOVERNMENT'
          ? 'Task progress is updated by the assigned organisation.'
          : 'You can update only tasks assigned to you.',
      );
    }

    const now = new Date();
    const afterCommit: Array<() => Promise<void>> = [];
    const task = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.resolutionTask.updateMany({
        where: { id: taskId, projectId: context.project.id, status: current.status },
        data: {
          status: to,
          ...(to === 'IN_PROGRESS' && !current.startedAt ? { startedAt: now } : {}),
          ...(to === 'COMPLETED' ? { completedAt: now, completedById: user.id } : {}),
          ...(to === 'CANCELLED' ? { cancelledAt: now } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        throw AppException.conflict(
          'Someone else updated this task a moment ago. Reload to see its current status.',
        );
      }
      await this.event(tx, context, user, 'TASK_STATUS_CHANGED', {
        taskId,
        subject: current.title,
        from: current.status,
        to,
      });
      if (to === 'IN_PROGRESS' && context.project.status === 'PLANNED') {
        // Work has begun: the project starts too.
        const fresh = await tx.resolutionProject.findUniqueOrThrow({
          where: { id: context.project.id },
        });
        if (fresh.status === 'PLANNED') {
          const publish = await this.applyTransition(
            { ...context, project: fresh },
            'PLANNED',
            'ACTIVE',
            null,
            user,
            tx,
          );
          afterCommit.push(publish);
        }
      }
      return tx.resolutionTask.findUniqueOrThrow({
        where: { id: taskId },
        include: TASK_INCLUDE,
      });
    });
    for (const publish of afterCommit) void publish();

    if (to === 'COMPLETED') {
      const problem = await this.problemRef(context.project.problemId);
      this.events.publish({
        type: 'PROJECT_TASK_COMPLETED',
        projectId: context.project.id,
        roomId: context.project.roomId,
        problemPublicId: problem.publicId,
        taskId,
        taskTitle: task.title,
        creatorId: task.createdById,
        actorUserId: user.id,
        actorName: task.completedBy?.fullName ?? 'Someone',
      });
    }
    return this.toTaskView(task, context, user, projectToday());
  }

  /** Links a room attachment the caller can see to a task. */
  async attachToTask(
    context: ProjectContext,
    taskId: string,
    attachmentId: string,
    user: RequestUser,
  ): Promise<TaskView> {
    this.requireEditable(context);
    const task = await this.findTask(context, taskId);
    if (!context.canManage && task.assignedToId !== user.id) {
      throw AppException.forbidden('You can attach files only to tasks assigned to you.');
    }
    const attachment = await this.prisma.resolutionAttachment.findFirst({
      where: {
        id: attachmentId,
        roomId: context.project.roomId,
        OR: [
          { message: { deletedAt: null } },
          { messageId: null, uploadedById: user.id },
        ],
      },
      select: { id: true, fileName: true },
    });
    if (!attachment)
      throw AppException.badRequest('That file is not in this resolution room.');
    const existing = await this.prisma.resolutionTaskAttachment.count({
      where: { taskId },
    });
    if (existing >= TASK_MAX_ATTACHMENTS) {
      throw AppException.badRequest(
        `A task can reference up to ${TASK_MAX_ATTACHMENTS} files.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.resolutionTaskAttachment.upsert({
        where: { taskId_attachmentId: { taskId, attachmentId } },
        create: { taskId, attachmentId },
        update: {},
      });
      await this.event(tx, context, user, 'TASK_UPDATED', {
        taskId,
        subject: task.title,
        fields: ['attachments'],
        detail: attachment.fileName,
      });
    });
    return this.task(context, taskId, user);
  }

  async detachFromTask(
    context: ProjectContext,
    taskId: string,
    attachmentId: string,
    user: RequestUser,
  ): Promise<TaskView> {
    this.requireEditable(context);
    const task = await this.findTask(context, taskId);
    if (!context.canManage && task.assignedToId !== user.id) {
      throw AppException.forbidden('You can change files only on tasks assigned to you.');
    }
    await this.prisma.resolutionTaskAttachment.deleteMany({
      where: { taskId, attachmentId },
    });
    return this.task(context, taskId, user);
  }

  /** Active members of the assigned organisation — the only valid assignees. */
  async assignees(context: ProjectContext): Promise<ProjectAssignee[]> {
    const members = await this.prisma.organizationMember.findMany({
      where: {
        organizationId: context.project.assignedOrganizationId,
        status: 'ACTIVE',
        user: { deletedAt: null },
      },
      select: { membershipRole: true, user: PERSON },
      orderBy: [{ membershipRole: 'asc' }, { user: { fullName: 'asc' } }],
    });
    return members.map((m) => ({ ...person(m.user)!, membershipRole: m.membershipRole }));
  }

  // ============================================================ milestones

  async milestones(context: ProjectContext): Promise<MilestoneView[]> {
    const today = projectToday();
    const [rows, counts] = await Promise.all([
      this.prisma.resolutionMilestone.findMany({
        where: { projectId: context.project.id },
        include: { completedBy: PERSON },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: 100,
      }),
      this.prisma.resolutionTask.groupBy({
        by: ['milestoneId', 'status'],
        where: { projectId: context.project.id, milestoneId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    return rows.map((row) => {
      const mine = counts.filter((c) => c.milestoneId === row.id);
      const n = (statuses: TaskStatus[]) =>
        mine
          .filter((c) => statuses.includes(c.status))
          .reduce((sum, c) => sum + c._count._all, 0);
      const total = n(['TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']);
      const completed = n(['COMPLETED']);
      const cancelled = n(['CANCELLED']);
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        dueDate: dateOut(row.dueDate),
        status: milestoneStatus({
          completedAt: row.completedAt?.toISOString() ?? null,
          dueDate: dateOut(row.dueDate),
          workStarted: n(['IN_PROGRESS', 'BLOCKED', 'COMPLETED']) > 0,
          today,
        }),
        completedAt: row.completedAt?.toISOString() ?? null,
        completedBy: person(row.completedBy),
        tasks: { total, completed, cancelled, open: total - completed - cancelled },
        progress: taskProgressPercent({ total, completed, cancelled }),
        version: row.version,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async createMilestone(
    context: ProjectContext,
    input: { title: string; description: string | null; dueDate: string | null },
    user: RequestUser,
  ): Promise<void> {
    this.requireManager(context);
    this.requireEditable(context);
    this.assertAfterStart(context, input.dueDate, 'A milestone');
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.resolutionMilestone.create({
        data: {
          projectId: context.project.id,
          title: input.title,
          description: input.description,
          dueDate: dateIn(input.dueDate),
          createdById: user.id,
        },
      });
      await this.event(tx, context, user, 'MILESTONE_CREATED', {
        milestoneId: created.id,
        subject: created.title,
      });
    });
  }

  async updateMilestone(
    context: ProjectContext,
    milestoneId: string,
    input: {
      version: number;
      title?: string;
      description?: string | null;
      dueDate?: string | null;
    },
    user: RequestUser,
  ): Promise<void> {
    this.requireManager(context);
    this.requireEditable(context);
    if (input.dueDate) this.assertAfterStart(context, input.dueDate, 'A milestone');
    await this.findMilestone(context, milestoneId);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.resolutionMilestone.updateMany({
        where: { id: milestoneId, projectId: context.project.id, version: input.version },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.dueDate !== undefined ? { dueDate: dateIn(input.dueDate) } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw staleConflict('milestone');
      const updated = await tx.resolutionMilestone.findUniqueOrThrow({
        where: { id: milestoneId },
      });
      await this.event(tx, context, user, 'MILESTONE_UPDATED', {
        milestoneId,
        subject: updated.title,
      });
    });
  }

  /** Complete only when none of its tasks is still open. */
  async completeMilestone(
    context: ProjectContext,
    milestoneId: string,
    user: RequestUser,
  ): Promise<void> {
    this.requireManager(context);
    this.requireEditable(context);
    const milestone = await this.findMilestone(context, milestoneId);
    const open = await this.prisma.resolutionTask.count({
      where: { milestoneId, status: { in: [...OPEN_TASK_STATUSES] } },
    });
    if (open > 0) {
      throw AppException.conflict(
        `This milestone still has ${open} open ${open === 1 ? 'task' : 'tasks'}.`,
      );
    }
    const completedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.resolutionMilestone.updateMany({
        where: { id: milestoneId, completedAt: null },
        data: { completedAt, completedById: user.id, version: { increment: 1 } },
      });
      if (count === 0)
        throw AppException.conflict('This milestone is already completed.');
      await this.event(tx, context, user, 'MILESTONE_COMPLETED', {
        milestoneId,
        subject: milestone.title,
      });
    });

    const problem = await this.problemRef(context.project.problemId);
    this.events.publish({
      type: 'PROJECT_MILESTONE_COMPLETED',
      projectId: context.project.id,
      roomId: context.project.roomId,
      problemPublicId: problem.publicId,
      milestoneId,
      milestoneTitle: milestone.title,
      completedAt: completedAt.toISOString(),
      actorUserId: user.id,
      actorOrganizationName: context.room.organization.name,
    });
  }

  async reopenMilestone(
    context: ProjectContext,
    milestoneId: string,
    user: RequestUser,
  ): Promise<void> {
    this.requireManager(context);
    this.requireEditable(context);
    const milestone = await this.findMilestone(context, milestoneId);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.resolutionMilestone.updateMany({
        where: { id: milestoneId, completedAt: { not: null } },
        data: { completedAt: null, completedById: null, version: { increment: 1 } },
      });
      if (count === 0) throw AppException.conflict('This milestone is not completed.');
      await this.event(tx, context, user, 'MILESTONE_REOPENED', {
        milestoneId,
        subject: milestone.title,
      });
    });
  }

  // ============================================================== activity

  async activity(
    context: ProjectContext,
    cursor: string | undefined,
  ): Promise<ProjectActivityPage> {
    const after = cursor ? decodeEventCursor(cursor) : null;
    const limit = 30;
    const rows = await this.prisma.resolutionRoomEvent.findMany({
      where: {
        roomId: context.project.roomId,
        type: { in: [...PROJECT_EVENT_TYPES] },
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      include: { actor: { select: { fullName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => {
        const meta = (row.metadata ?? {}) as Record<string, unknown>;
        const text = (key: string) =>
          typeof meta[key] === 'string' ? (meta[key] as string) : null;
        return {
          id: row.id,
          kind: row.type as ProjectActivityKind,
          actor: row.actor
            ? { name: row.actor.fullName, organizationName: text('organizationName') }
            : null,
          subject: text('subject'),
          from: text('from'),
          to: text('to'),
          detail: text('detail') ?? text('reason'),
          createdAt: row.createdAt.toISOString(),
        } satisfies ProjectActivityEntry;
      }),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString(
              'base64url',
            )
          : null,
    };
  }

  // ============================================================ dashboards

  /** Live projects for an organisation or an office, most overdue first. */
  async summaries(where: {
    assignedOrganizationId?: string;
    governmentOrganizationId?: string;
  }): Promise<ProjectSummary[]> {
    const projects = await this.prisma.resolutionProject.findMany({
      where: {
        ...where,
        status: { in: [...PROJECT_EDITABLE_STATUSES] },
        problem: { deletedAt: null },
      },
      include: {
        problem: { select: { publicId: true } },
        governmentOrganization: { select: { name: true } },
        assignedOrganization: { select: { name: true } },
      },
      orderBy: [{ targetDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 20,
    });
    const overviews = await this.overviews(projects.map((p) => p.id));
    return projects
      .map((project) => ({
        id: project.id,
        roomId: project.roomId,
        name: project.name,
        status: project.status,
        problemPublicId: project.problem.publicId,
        government: { name: project.governmentOrganization.name },
        organization: { name: project.assignedOrganization.name },
        targetDate: dateOut(project.targetDate),
        overview: overviews.get(project.id) ?? emptyOverview(),
      }))
      .sort((a, b) => b.overview.tasks.overdue - a.overview.tasks.overdue)
      .slice(0, 6);
  }

  async countLive(where: {
    assignedOrganizationId?: string;
    governmentOrganizationId?: string;
  }): Promise<number> {
    return this.prisma.resolutionProject.count({
      where: { ...where, status: { in: [...PROJECT_EDITABLE_STATUSES] } },
    });
  }

  /** Overview metrics for several projects in three queries. */
  async overviews(projectIds: string[]): Promise<Map<string, ProjectOverview>> {
    const result = new Map<string, ProjectOverview>();
    if (projectIds.length === 0) return result;
    const today = dateIn(projectToday())!;
    const [byStatus, overdue, milestones] = await Promise.all([
      this.prisma.resolutionTask.groupBy({
        by: ['projectId', 'status'],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      }),
      this.prisma.resolutionTask.groupBy({
        by: ['projectId'],
        where: {
          projectId: { in: projectIds },
          status: { in: [...OPEN_TASK_STATUSES] },
          dueDate: { lt: today },
        },
        _count: { _all: true },
      }),
      this.prisma.resolutionMilestone.findMany({
        where: { projectId: { in: projectIds } },
        select: { projectId: true, completedAt: true, dueDate: true },
      }),
    ]);

    for (const id of projectIds) {
      const n = (status: TaskStatus) =>
        byStatus.find((g) => g.projectId === id && g.status === status)?._count._all ?? 0;
      const tasks: TaskCounts = {
        todo: n('TODO'),
        inProgress: n('IN_PROGRESS'),
        blocked: n('BLOCKED'),
        completed: n('COMPLETED'),
        cancelled: n('CANCELLED'),
        overdue: overdue.find((g) => g.projectId === id)?._count._all ?? 0,
        total: 0,
      };
      tasks.total =
        tasks.todo + tasks.inProgress + tasks.blocked + tasks.completed + tasks.cancelled;
      const mine = milestones.filter((m) => m.projectId === id);
      const completedMilestones = mine.filter((m) => m.completedAt).length;
      result.set(id, {
        tasks,
        taskProgress: taskProgressPercent(tasks),
        milestones: {
          total: mine.length,
          completed: completedMilestones,
          overdue: mine.filter((m) => !m.completedAt && m.dueDate && m.dueDate < today)
            .length,
        },
        milestoneProgress: milestoneProgressPercent(completedMilestones, mine.length),
      });
    }
    return result;
  }

  // =============================================================== helpers

  private allowedTaskTransitions(
    context: ProjectContext,
    task: { status: TaskStatus; assignedToId: string | null },
    user: RequestUser,
  ): TaskStatus[] {
    if (!context.isEditable) return [];
    let moves = [...TASK_TRANSITIONS[task.status]];
    if (context.project.status === 'PAUSED') {
      moves = moves.filter((to) => to !== 'IN_PROGRESS' && to !== 'COMPLETED');
    }
    if (context.canManage) return moves;
    if (context.room.side === 'ORGANIZATION' && task.assignedToId === user.id) {
      return moves.filter((to) => TASK_ASSIGNEE_TRANSITIONS.includes(to));
    }
    return [];
  }

  private toTaskView(
    row: TaskRow,
    context: ProjectContext,
    user: RequestUser,
    today: string,
  ): TaskView {
    const dueDate = dateOut(row.dueDate);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assignee: person(row.assignedTo),
      milestone: row.milestone,
      dueDate,
      overdue: isOverdue(dueDate, row.status, today),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      completedBy: person(row.completedBy),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      createdBy: person(row.createdBy)!,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
      // A file whose message was deleted is no longer shown, here or anywhere.
      attachments: row.attachments
        .filter((link) => link.attachment.message?.deletedAt == null)
        .map((link) => toAttachmentView(link.attachment, context.project.roomId)),
      allowedTransitions: this.allowedTaskTransitions(context, row, user),
      canEdit:
        context.canManage &&
        context.isEditable &&
        OPEN_TASK_STATUSES.includes(row.status),
    };
  }

  private async validateTaskRefs(
    context: ProjectContext,
    input: {
      assignedToId: string | null;
      dueDate: string | null;
      milestoneId: string | null;
    },
  ): Promise<void> {
    if (input.assignedToId) {
      // Only active members of the assigned organisation — never anyone else.
      const member = await this.prisma.organizationMember.findFirst({
        where: {
          organizationId: context.project.assignedOrganizationId,
          userId: input.assignedToId,
          status: 'ACTIVE',
          user: { deletedAt: null },
        },
        select: { id: true },
      });
      if (!member) {
        throw AppException.badRequest(
          `Tasks can be assigned only to active members of ${context.room.room.assignedOrganization.name}.`,
        );
      }
    }
    if (input.milestoneId) {
      const milestone = await this.prisma.resolutionMilestone.findFirst({
        where: { id: input.milestoneId, projectId: context.project.id },
        select: { completedAt: true },
      });
      if (!milestone)
        throw AppException.badRequest('That milestone is not in this project.');
      if (milestone.completedAt) {
        throw AppException.badRequest(
          'That milestone is completed. Reopen it to add tasks.',
        );
      }
    }
    this.assertAfterStart(context, input.dueDate, 'A task');
  }

  private assertAfterStart(
    context: ProjectContext,
    dueDate: string | null,
    what: string,
  ): void {
    const start = dateOut(context.project.startDate);
    if (dueDate && start && dueDate < start) {
      throw AppException.badRequest(
        `${what} cannot be due before the project starts (${start}).`,
      );
    }
  }

  private async assertNoDatesBefore(projectId: string, startDate: string): Promise<void> {
    const start = dateIn(startDate)!;
    const [tasks, milestones] = await Promise.all([
      this.prisma.resolutionTask.count({
        where: {
          projectId,
          dueDate: { lt: start },
          status: { in: [...OPEN_TASK_STATUSES] },
        },
      }),
      this.prisma.resolutionMilestone.count({
        where: { projectId, dueDate: { lt: start }, completedAt: null },
      }),
    ]);
    if (tasks + milestones > 0) {
      throw AppException.badRequest(
        'Some open tasks or milestones are due before that start date. Move them first.',
      );
    }
  }

  private async findTask(context: ProjectContext, taskId: string) {
    const task = await this.prisma.resolutionTask.findFirst({
      where: { id: taskId, projectId: context.project.id },
    });
    if (!task) throw AppException.notFound('Task');
    return task;
  }

  private async findMilestone(context: ProjectContext, milestoneId: string) {
    const milestone = await this.prisma.resolutionMilestone.findFirst({
      where: { id: milestoneId, projectId: context.project.id },
    });
    if (!milestone) throw AppException.notFound('Milestone');
    return milestone;
  }

  private event(
    tx: Prisma.TransactionClient,
    context: ProjectContext,
    user: RequestUser,
    type: (typeof PROJECT_EVENT_TYPES)[number],
    metadata: Record<string, unknown>,
  ) {
    return tx.resolutionRoomEvent.create({
      data: {
        roomId: context.project.roomId,
        type,
        actorId: user.id,
        metadata: {
          projectId: context.project.id,
          organizationName: context.room.organization.name,
          ...metadata,
        } as Prisma.InputJsonObject,
      },
      select: { id: true },
    });
  }

  private async publishAssigned(
    context: ProjectContext,
    task: TaskRow,
    user: RequestUser,
  ) {
    const problem = await this.problemRef(context.project.problemId);
    this.events.publish({
      type: 'PROJECT_TASK_ASSIGNED',
      projectId: context.project.id,
      roomId: context.project.roomId,
      problemPublicId: problem.publicId,
      taskId: task.id,
      taskTitle: task.title,
      assigneeId: task.assignedToId!,
      taskVersion: task.version,
      actorUserId: user.id,
    });
  }

  private problemRef(problemId: string) {
    return this.prisma.problem.findUniqueOrThrow({
      where: { id: problemId },
      select: { publicId: true },
    });
  }
}

// ---------------------------------------------------------------- helpers

/** `YYYY-MM-DD` → a UTC-midnight Date for a `@db.Date` column. */
export function dateIn(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

function day(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function dateOut(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function person(
  user: { id: string; fullName: string; avatarUrl: string | null } | null,
): TaskPerson | null {
  return user
    ? { userId: user.id, name: user.fullName, avatarUrl: user.avatarUrl }
    : null;
}

function emptyOverview(): ProjectOverview {
  return {
    tasks: {
      total: 0,
      todo: 0,
      inProgress: 0,
      blocked: 0,
      completed: 0,
      cancelled: 0,
      overdue: 0,
    },
    taskProgress: 0,
    milestones: { total: 0, completed: 0, overdue: 0 },
    milestoneProgress: 0,
  };
}

function staleConflict(what: string): AppException {
  return AppException.conflict(
    `This ${what} was changed by someone else a moment ago. Reload to see the latest version.`,
  );
}

function label(status: string): string {
  return status.toLowerCase().replace('_', ' ');
}

function decodeEventCursor(cursor: string): { createdAt: Date; id: string } {
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
