import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { MatchesService } from './matches.service.js';
import { MatchingController } from './matching.controller.js';
import { MatchingEventHandler } from './matching-event.handler.js';
import { OrganizationEmbeddingService } from './organization-embedding.service.js';
import { OrganizationMatchingService } from './organization-matching.service.js';

/**
 * AI organisation matching (Prompt 14): embeddings for organisations, the
 * background matching job, its triggers and the public read.
 *
 * Organisation-side reads (recommendations in a workspace) live with the
 * workspace, behind its membership guard; they only read the match table.
 */
@Module({
  imports: [AiModule],
  controllers: [MatchingController],
  providers: [
    OrganizationEmbeddingService,
    OrganizationMatchingService,
    MatchingEventHandler,
    MatchesService,
  ],
  exports: [
    OrganizationMatchingService,
    OrganizationEmbeddingService,
    MatchingEventHandler,
  ],
})
export class MatchingModule {}
