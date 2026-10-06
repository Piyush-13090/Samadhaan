import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { OPEN_TASK_STATUSES, projectToday } from '@samadhaan/shared';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import { dateIn, dateOut } from './projects.service.js';

const SWEEP_MS = 60 * 60 * 1000;

/**
 * "Task due soon": once, to the assignee, for open tasks due today or
 * tomorrow in a live project. A plain hourly sweep — deterministic, no AI,
 * no per-project schedule. Idempotent: the notification's dedupe key is the
 * task and its due date, so any number of sweeps (or API instances) send one.
 */
@Injectable()
export class ProjectRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectRemindersService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return;
    setTimeout(() => void this.sweep(), 30_000).unref();
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public for tests and operations. Returns how many reminders were published. */
  async sweep(now: Date = new Date()): Promise<number> {
    try {
      const today = projectToday(now);
      const tomorrow = projectToday(new Date(now.getTime() + 24 * 60 * 60 * 1000));
      const tasks = await this.prisma.resolutionTask.findMany({
        where: {
          status: { in: [...OPEN_TASK_STATUSES] },
          assignedToId: { not: null },
          dueDate: { gte: dateIn(today)!, lte: dateIn(tomorrow)! },
          project: { status: { in: ['PLANNED', 'ACTIVE'] }, room: { status: 'OPEN' } },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          assignedToId: true,
          project: {
            select: { id: true, roomId: true, problem: { select: { publicId: true } } },
          },
        },
        take: 1000,
      });
      for (const task of tasks) {
        this.events.publish({
          type: 'PROJECT_TASK_DUE_SOON',
          projectId: task.project.id,
          roomId: task.project.roomId,
          problemPublicId: task.project.problem.publicId,
          taskId: task.id,
          taskTitle: task.title,
          assigneeId: task.assignedToId!,
          dueDate: dateOut(task.dueDate)!,
        });
      }
      return tasks.length;
    } catch (error) {
      this.logger.warn(
        `Due-soon sweep failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return 0;
    }
  }
}
