import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { ResolutionModule } from '../resolution/resolution.module.js';
import { CoordinatorContextService } from './coordinator-context.service.js';
import { CoordinatorController } from './coordinator.controller.js';
import { CoordinatorSchedulerService } from './coordinator-scheduler.service.js';
import { CoordinatorService } from './coordinator.service.js';

/**
 * The AI Project Coordinator (Prompt 19): advisory insights, questions and
 * structured updates over resolution projects. Reads projects through
 * `ResolutionModule` (whose access rules it reuses) and the model through
 * `AiModule`. It writes only its own tables.
 */
@Module({
  imports: [AiModule, ResolutionModule, KnowledgeModule],
  controllers: [CoordinatorController],
  providers: [CoordinatorService, CoordinatorContextService, CoordinatorSchedulerService],
})
export class CoordinatorModule {}
