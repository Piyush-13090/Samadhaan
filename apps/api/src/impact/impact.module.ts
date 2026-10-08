import { Module } from '@nestjs/common';
import { BadgeEvaluationService } from './badge-evaluation.service.js';
import { ContributionAttributionService } from './contribution-attribution.service.js';
import {
  AdminImpactController,
  ImpactController,
  LeaderboardController,
} from './impact.controller.js';
import { ImpactEventHandler } from './impact-event.handler.js';
import { ImpactLedgerService } from './impact-ledger.service.js';
import { ImpactQueryService } from './impact-query.service.js';
import { ReputationService } from './reputation.service.js';

/**
 * Impact points, reputation, badges and the leaderboard (Prompt 23).
 * See docs/IMPACT_POINTS.md and docs/REPUTATION_SYSTEM.md.
 */
@Module({
  controllers: [ImpactController, LeaderboardController, AdminImpactController],
  providers: [
    ImpactLedgerService,
    ContributionAttributionService,
    ReputationService,
    BadgeEvaluationService,
    ImpactEventHandler,
    ImpactQueryService,
  ],
  exports: [ImpactLedgerService],
})
export class ImpactModule {}
