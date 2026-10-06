import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  API_VERSION,
  type MilestoneView,
  type ProjectActivityPage,
  type ProjectAssignee,
  type ProjectView,
  type TaskPage,
  type TaskView,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import {
  ActivityQueryDto,
  CreateMilestoneDto,
  CreateTaskDto,
  ProjectStatusDto,
  TaskAttachmentDto,
  TaskStatusDto,
  TasksQueryDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
  UpdateTaskDto,
} from './projects.dto.js';
import { ProjectsService } from './projects.service.js';

/** A room's project, by room id — how both portals reach it. */
@Controller({ path: 'resolution-rooms', version: API_VERSION.replace('v', '') })
export class RoomProjectController {
  constructor(private readonly projects: ProjectsService) {}

  @Get(':id/project')
  async project(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) roomId: string,
  ): Promise<ProjectView> {
    return this.projects.view(await this.projects.resolveByRoom(roomId, user), user);
  }
}

/**
 * `/api/v1/resolution-projects/:id` — tasks, milestones and progress. Every
 * route resolves the caller's access through the project's room first;
 * anyone who cannot enter the room gets 404.
 */
@Controller({ path: 'resolution-projects', version: API_VERSION.replace('v', '') })
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get(':id')
  async project(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectView> {
    return this.projects.view(await this.projects.resolve(id, user), user);
  }

  @Patch(':id')
  @UserRateLimit({ bucket: 'project-write', max: 60, windowSeconds: 60 })
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectView> {
    await this.projects.update(await this.projects.resolve(id, user), dto, user);
    return this.projects.view(await this.projects.resolve(id, user), user);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'project-write', max: 60, windowSeconds: 60 })
  async status(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProjectStatusDto,
  ): Promise<ProjectView> {
    await this.projects.transition(
      await this.projects.resolve(id, user),
      dto.status,
      dto.reason ?? null,
      user,
    );
    return this.projects.view(await this.projects.resolve(id, user), user);
  }

  @Get(':id/assignees')
  async assignees(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectAssignee[]> {
    return this.projects.assignees(await this.projects.resolve(id, user));
  }

  @Get(':id/activity')
  async activity(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ActivityQueryDto,
  ): Promise<ProjectActivityPage> {
    return this.projects.activity(await this.projects.resolve(id, user), query.cursor);
  }

  // ----------------------------------------------------------------- tasks

  @Get(':id/tasks')
  async tasks(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TasksQueryDto,
  ): Promise<TaskPage> {
    return this.projects.tasks(await this.projects.resolve(id, user), query, user);
  }

  @Post(':id/tasks')
  @HttpCode(HttpStatus.CREATED)
  @UserRateLimit({ bucket: 'project-write', max: 60, windowSeconds: 60 })
  async createTask(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskView> {
    return this.projects.createTask(
      await this.projects.resolve(id, user),
      {
        title: dto.title,
        description: dto.description ?? null,
        priority: dto.priority ?? 'MEDIUM',
        assignedToId: dto.assignedToId ?? null,
        dueDate: dto.dueDate ?? null,
        milestoneId: dto.milestoneId ?? null,
      },
      user,
    );
  }

  @Get(':id/tasks/:taskId')
  async task(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<TaskView> {
    return this.projects.task(await this.projects.resolve(id, user), taskId, user);
  }

  /** Details only. Status has its own endpoint and state machine. */
  @Patch(':id/tasks/:taskId')
  @UserRateLimit({ bucket: 'project-write', max: 60, windowSeconds: 60 })
  async updateTask(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskView> {
    return this.projects.updateTask(
      await this.projects.resolve(id, user),
      taskId,
      dto,
      user,
    );
  }

  @Post(':id/tasks/:taskId/status')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'project-write', max: 60, windowSeconds: 60 })
  async taskStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: TaskStatusDto,
  ): Promise<TaskView> {
    return this.projects.transitionTask(
      await this.projects.resolve(id, user),
      taskId,
      dto.status,
      user,
    );
  }

  @Post(':id/tasks/:taskId/attachments')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'project-write', max: 60, windowSeconds: 60 })
  async attach(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: TaskAttachmentDto,
  ): Promise<TaskView> {
    return this.projects.attachToTask(
      await this.projects.resolve(id, user),
      taskId,
      dto.attachmentId,
      user,
    );
  }

  @Delete(':id/tasks/:taskId/attachments/:attachmentId')
  async detach(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<TaskView> {
    return this.projects.detachFromTask(
      await this.projects.resolve(id, user),
      taskId,
      attachmentId,
      user,
    );
  }

  // ------------------------------------------------------------ milestones

  @Get(':id/milestones')
  async milestones(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MilestoneView[]> {
    return this.projects.milestones(await this.projects.resolve(id, user));
  }

  @Post(':id/milestones')
  @HttpCode(HttpStatus.CREATED)
  @UserRateLimit({ bucket: 'project-write', max: 60, windowSeconds: 60 })
  async createMilestone(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMilestoneDto,
  ): Promise<MilestoneView[]> {
    const context = await this.projects.resolve(id, user);
    await this.projects.createMilestone(
      context,
      {
        title: dto.title,
        description: dto.description ?? null,
        dueDate: dto.dueDate ?? null,
      },
      user,
    );
    return this.projects.milestones(context);
  }

  @Patch(':id/milestones/:milestoneId')
  @UserRateLimit({ bucket: 'project-write', max: 60, windowSeconds: 60 })
  async updateMilestone(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
  ): Promise<MilestoneView[]> {
    const context = await this.projects.resolve(id, user);
    await this.projects.updateMilestone(context, milestoneId, dto, user);
    return this.projects.milestones(context);
  }

  @Post(':id/milestones/:milestoneId/complete')
  @HttpCode(HttpStatus.OK)
  async completeMilestone(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
  ): Promise<MilestoneView[]> {
    const context = await this.projects.resolve(id, user);
    await this.projects.completeMilestone(context, milestoneId, user);
    return this.projects.milestones(context);
  }

  @Post(':id/milestones/:milestoneId/reopen')
  @HttpCode(HttpStatus.OK)
  async reopenMilestone(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
  ): Promise<MilestoneView[]> {
    const context = await this.projects.resolve(id, user);
    await this.projects.reopenMilestone(context, milestoneId, user);
    return this.projects.milestones(context);
  }
}
