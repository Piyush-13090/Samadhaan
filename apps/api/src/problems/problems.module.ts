import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AiModule } from '../ai/ai.module.js';
import { AppConfig } from '../config/app.config.js';
import { ProblemsController } from './problems.controller.js';
import { ProblemsService } from './problems.service.js';
import { ImageValidationService } from './services/image-validation.service.js';
import { PendingUploadService } from './services/pending-upload.service.js';
import { DuplicateDetectionService } from './services/duplicate-detection.service.js';
import { DuplicateScoringService } from './services/duplicate-scoring.service.js';
import { ProblemDiscoveryService } from './services/problem-discovery.service.js';
import { ProblemAnalysisService } from './services/problem-analysis.service.js';

/**
 * Civic problem reporting.
 *
 * `AiModule` is imported for analysis and embeddings; the browser never reaches
 * the AI service, so every call goes through this boundary.
 *
 * Multer is configured with memory storage and a hard byte limit. Memory
 * because the validator must decode the bytes before anything is persisted —
 * a file written to disk before validation is a file that might not be an
 * image. The limit is enforced by multer *and* re-checked in the validator, so
 * the cap holds even if this configuration is changed.
 */
@Module({
  imports: [
    AiModule,
    MulterModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        limits: {
          fileSize: config.maxImageBytes,
          // One file per request; the client uploads images individually so it
          // can show per-file progress and retry just the one that failed.
          files: 1,
          // Bounded so a request cannot arrive with thousands of form fields.
          fields: 10,
        },
      }),
    }),
  ],
  controllers: [ProblemsController],
  providers: [
    ProblemsService,
    ImageValidationService,
    PendingUploadService,
    ProblemAnalysisService,
    DuplicateScoringService,
    DuplicateDetectionService,
    ProblemDiscoveryService,
  ],
  exports: [
    ProblemsService,
    ProblemAnalysisService,
    DuplicateDetectionService,
    ProblemDiscoveryService,
  ],
})
export class ProblemsModule {}
