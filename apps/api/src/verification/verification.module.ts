import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { EVIDENCE_VIDEO_MAX_BYTES } from '@samadhaan/shared';
import { AiModule } from '../ai/ai.module.js';
import { GovernmentModule } from '../government/government.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { ResolutionModule } from '../resolution/resolution.module.js';
import { EvidenceService } from './evidence.service.js';
import { GovernmentVerificationService } from './government-verification.service.js';
import { VerificationAnalysisService } from './verification-analysis.service.js';
import {
  EvidenceController,
  GovernmentVerificationController,
} from './verification.controller.js';
import { VerificationJobsService } from './verification-jobs.service.js';

/**
 * AI-assisted resolution verification (Prompt 22). AI review is advisory; the
 * allocating government office decides. See docs/RESOLUTION_VERIFICATION.md.
 */
@Module({
  imports: [
    AiModule,
    GovernmentModule,
    KnowledgeModule,
    ResolutionModule,
    // One file per request; the largest type (video) bounds the buffer, and
    // each type's own limit is checked against the bytes in the service.
    MulterModule.register({
      limits: { fileSize: EVIDENCE_VIDEO_MAX_BYTES, files: 1, fields: 3 },
    }),
  ],
  controllers: [EvidenceController, GovernmentVerificationController],
  providers: [
    EvidenceService,
    GovernmentVerificationService,
    VerificationAnalysisService,
    VerificationJobsService,
  ],
  exports: [VerificationJobsService],
})
export class VerificationModule {}
