import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { KNOWLEDGE_UPLOAD_MAX_BYTES } from '@samadhaan/shared';
import { AiModule } from '../ai/ai.module.js';
import { ProblemsModule } from '../problems/problems.module.js';
import { ResolutionModule } from '../resolution/resolution.module.js';
import { KnowledgeAccessService } from './knowledge-access.service.js';
import { KnowledgeContextBuilder } from './knowledge-context.builder.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import { KnowledgeQueryService } from './knowledge-query.service.js';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service.js';
import { KnowledgeSourcesService } from './knowledge-sources.service.js';

/**
 * Knowledge & RAG (Prompt 20). Exports retrieval and access so the AI Project
 * Coordinator can draw on authorised knowledge.
 */
@Module({
  imports: [
    AiModule,
    ProblemsModule,
    ResolutionModule,
    MulterModule.register({
      limits: { fileSize: KNOWLEDGE_UPLOAD_MAX_BYTES, files: 1, fields: 5 },
    }),
  ],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeAccessService,
    KnowledgeContextBuilder,
    KnowledgeIngestionService,
    KnowledgeQueryService,
    KnowledgeRetrievalService,
    KnowledgeSourcesService,
  ],
  exports: [KnowledgeRetrievalService, KnowledgeAccessService, KnowledgeIngestionService],
})
export class KnowledgeModule {}
