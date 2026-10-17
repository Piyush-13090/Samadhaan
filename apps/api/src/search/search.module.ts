import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { GovernmentModule } from '../government/government.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { KnowledgeSearchService } from './knowledge-search.service.js';
import { OrganizationSearchService } from './organization-search.service.js';
import { ProblemSearchService } from './problem-search.service.js';
import { ProjectSearchService } from './project-search.service.js';
import { SearchAuthorizationService } from './search-authorization.service.js';
import { SearchCacheService } from './search-cache.service.js';
import { SearchHistoryService } from './search-history.service.js';
import { SearchQueryUnderstandingService } from './search-query-understanding.service.js';
import { SearchRankingService } from './search-ranking.service.js';
import { SearchSuggestionService } from './search-suggestion.service.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

/**
 * Advanced search and discovery (Prompt 25): PostgreSQL full text, pgvector
 * and PostGIS behind one access-controlled API. See docs/SEARCH_ARCHITECTURE.md.
 */
@Module({
  imports: [AiModule, GovernmentModule, KnowledgeModule],
  controllers: [SearchController],
  providers: [
    SearchAuthorizationService,
    SearchCacheService,
    SearchHistoryService,
    SearchQueryUnderstandingService,
    SearchRankingService,
    ProblemSearchService,
    OrganizationSearchService,
    KnowledgeSearchService,
    ProjectSearchService,
    SearchSuggestionService,
    SearchService,
  ],
})
export class SearchModule {}
