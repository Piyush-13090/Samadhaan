import { Module } from '@nestjs/common';
import { AllocationsModule } from '../allocations/allocations.module.js';
import { ResolutionModule } from '../resolution/resolution.module.js';
import { ProblemsModule } from '../problems/problems.module.js';
import { GovernmentAccessService } from './government-access.service.js';
import { GovernmentController } from './government.controller.js';
import { GovernmentGuard } from './government.guard.js';
import { GovernmentMapService } from './government-map.service.js';
import { GovernmentProblemsService } from './government-problems.service.js';
import { GovernmentService } from './government.service.js';

/**
 * The government portal (Prompt 15): review and civic intelligence inside a
 * government office's jurisdiction. Allocation, resolution and verification
 * of completed work are later milestones.
 */
@Module({
  imports: [ProblemsModule, AllocationsModule, ResolutionModule],
  controllers: [GovernmentController],
  providers: [
    GovernmentAccessService,
    GovernmentGuard,
    GovernmentService,
    GovernmentProblemsService,
    GovernmentMapService,
  ],
  // For the priority engine's government endpoints (Prompt 21), which reuse
  // the portal's guard and jurisdiction check.
  exports: [GovernmentAccessService, GovernmentGuard, GovernmentProblemsService],
})
export class GovernmentModule {}
