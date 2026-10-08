import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { GovernmentModule } from '../government/government.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { ProblemsModule } from '../problems/problems.module.js';
import { PriorityCalculationService } from './priority-calculation.service.js';
import {
  GovernmentPriorityController,
  PublicPriorityController,
} from './priority.controller.js';
import { PriorityFeatureService } from './priority-feature.service.js';
import { PriorityJobsService } from './priority-jobs.service.js';
import { PriorityService } from './priority.service.js';

/**
 * AI Priority Engine (Prompt 21): advisory, explainable civic prioritisation
 * for government review. See docs/AI_PRIORITY_ENGINE.md.
 */
@Module({
  imports: [AiModule, GovernmentModule, KnowledgeModule, ProblemsModule],
  controllers: [GovernmentPriorityController, PublicPriorityController],
  providers: [
    PriorityFeatureService,
    PriorityCalculationService,
    PriorityJobsService,
    PriorityService,
  ],
  exports: [PriorityCalculationService, PriorityJobsService],
})
export class PriorityModule {}
