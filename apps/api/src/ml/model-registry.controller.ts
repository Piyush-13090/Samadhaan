import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { API_VERSION } from '@samadhaan/shared';
import type { Request } from 'express';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { ModelTask } from '../generated/prisma/client.js';
import { ModelMonitoringService } from './model-monitoring.service.js';
import {
  ApproveModelDto,
  LifecycleReasonDto,
  ListModelsQueryDto,
  MonitoringQueryDto,
  RecordEvaluationDto,
  RegisterModelDto,
} from './model-registry.dto.js';
import { ModelRegistryService } from './model-registry.service.js';

const requestId = (req: Request) => (req as Request & { id?: string }).id;

/**
 * Model registry administration (Prompt 28). Platform ADMIN only: citizens,
 * organisation members and government officials cannot register, approve,
 * activate or roll back models. Every state change is audited.
 * See docs/MODEL_LIFECYCLE.md.
 */
@Controller({ path: 'admin/ml', version: API_VERSION.replace('v', '') })
@Roles('ADMIN')
@UserRateLimit({ bucket: 'ml-admin', max: 60, windowSeconds: 60 })
export class ModelRegistryController {
  constructor(
    private readonly registry: ModelRegistryService,
    private readonly monitoring: ModelMonitoringService,
  ) {}

  @Get('models')
  list(@Query() query: ListModelsQueryDto) {
    return this.registry.list(query.task);
  }

  @Get('models/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.registry.get(id);
  }

  @Post('models')
  register(@Body() dto: RegisterModelDto, @CurrentUser() user: RequestUser) {
    return this.registry.register(dto, user);
  }

  @Post('models/:id/evaluation')
  @HttpCode(HttpStatus.OK)
  recordEvaluation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordEvaluationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.registry.recordEvaluation(id, dto, user);
  }

  @Post('models/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveModelDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.registry.approve(id, dto, user);
  }

  @Post('models/:id/activate')
  @HttpCode(HttpStatus.OK)
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LifecycleReasonDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.registry.activate(id, dto, user, requestId(req));
  }

  @Post('models/:id/retire')
  @HttpCode(HttpStatus.OK)
  retire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LifecycleReasonDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.registry.retire(id, dto, user);
  }

  @Get('tasks')
  tasks() {
    return this.registry.tasks();
  }

  @Post('tasks/:task/rollback')
  @HttpCode(HttpStatus.OK)
  rollback(
    @Param('task', new ParseEnumPipe(ModelTask)) task: ModelTask,
    @Body() dto: LifecycleReasonDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.registry.rollback(task, dto, user, requestId(req));
  }

  @Post('tasks/:task/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @Param('task', new ParseEnumPipe(ModelTask)) task: ModelTask,
    @Body() dto: LifecycleReasonDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.registry.deactivate(task, dto, user);
  }

  @Get('monitoring')
  report(@Query() query: MonitoringQueryDto) {
    return this.monitoring.report(query.task, query.days);
  }
}
