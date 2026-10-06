import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  API_VERSION,
  type CoordinatorView,
  type ExtractedUpdateView,
  type ProjectUpdateView,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { ProjectsService } from '../resolution/projects.service.js';
import {
  AnswerQuestionDto,
  ExtractUpdateDto,
  PostUpdateDto,
  UpdatesQueryDto,
} from './coordinator.dto.js';
import { CoordinatorService } from './coordinator.service.js';

const QUICK_TEXT = { COMPLETED: 'Yes, completed.', NOT_YET: 'Not yet.' } as const;

/**
 * `/api/v1/resolution-projects/:id/ai-coordinator` and `/updates`.
 *
 * Every route resolves the caller's access through the project's room first
 * (`ProjectsService.resolve`) — anyone who cannot enter the room gets 404.
 * Nothing here changes tasks, milestones or project status.
 */
@Controller({ path: 'resolution-projects', version: API_VERSION.replace('v', '') })
export class CoordinatorController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly coordinator: CoordinatorService,
  ) {}

  /** Live health plus the cached AI interpretation. Never calls the model. */
  @Get(':id/ai-coordinator')
  async view(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CoordinatorView> {
    return this.coordinator.view(await this.projects.resolve(id, user));
  }

  /** Runs the AI now. Per-user and per-project limits keep it affordable. */
  @Post(':id/ai-coordinator/refresh')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'coordinator-refresh', max: 5, windowSeconds: 600 })
  async refresh(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CoordinatorView> {
    const context = await this.projects.resolve(id, user);
    await this.coordinator.refreshManually(context, user);
    return this.coordinator.view(context);
  }

  @Post(':id/ai-coordinator/questions/:questionId/answer')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'coordinator-answer', max: 30, windowSeconds: 60 })
  async answer(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: AnswerQuestionDto,
  ): Promise<CoordinatorView> {
    const context = await this.projects.resolve(id, user);
    const text = [dto.quick ? QUICK_TEXT[dto.quick] : null, dto.answer ?? null]
      .filter(Boolean)
      .join(' ');
    await this.coordinator.answer(context, questionId, text, user);
    return this.coordinator.view(context);
  }

  @Post(':id/ai-coordinator/questions/:questionId/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismiss(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ): Promise<CoordinatorView> {
    const context = await this.projects.resolve(id, user);
    await this.coordinator.dismiss(context, questionId, user);
    return this.coordinator.view(context);
  }

  /** A draft for a person to review. Nothing is saved. */
  @Post(':id/ai-coordinator/extract-update')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'coordinator-extract', max: 10, windowSeconds: 600 })
  async extract(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtractUpdateDto,
  ): Promise<ExtractedUpdateView> {
    return this.coordinator.extract(await this.projects.resolve(id, user), dto, user);
  }

  @Get(':id/updates')
  async updates(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: UpdatesQueryDto,
  ): Promise<{ items: ProjectUpdateView[]; nextCursor: string | null }> {
    return this.coordinator.updates(await this.projects.resolve(id, user), query.cursor);
  }

  @Post(':id/updates')
  @HttpCode(HttpStatus.CREATED)
  @UserRateLimit({ bucket: 'project-update', max: 20, windowSeconds: 600 })
  async postUpdate(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostUpdateDto,
  ): Promise<ProjectUpdateView> {
    return this.coordinator.postUpdate(
      await this.projects.resolve(id, user),
      {
        summary: dto.summary,
        completed: dto.completed ?? [],
        current: dto.current ?? [],
        blockers: dto.blockers ?? [],
        nextSteps: dto.nextSteps ?? [],
        source: dto.source ?? 'MANUAL',
        aiModel: dto.aiModel ?? null,
      },
      user,
    );
  }
}
