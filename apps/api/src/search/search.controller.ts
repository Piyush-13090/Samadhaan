import { Controller, Delete, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import {
  API_VERSION,
  type KnowledgeSearchResult,
  type OrganizationSearchResult,
  type ProblemSearchResult,
  type ProjectSearchResult,
  type SearchMetrics,
  type SearchPage,
  type SearchSuggestions,
  type UnifiedSearchResponse,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { SearchHistoryService } from './search-history.service.js';
import { SearchSuggestionService } from './search-suggestion.service.js';
import { SearchService } from './search.service.js';
import {
  KnowledgeSearchDto,
  OrganizationSearchDto,
  ProblemSearchDto,
  ProjectSearchDto,
  SuggestDto,
  UnifiedSearchDto,
} from './search.dto.js';

/**
 * Search and discovery (Prompt 25). Signed-in users only (the global auth
 * guard); every result passes the entity's access policy in SQL.
 *
 * Rate limits are tiered by cost: suggestions are cheap (indexed prefix
 * matches), searches embed the query and may call the AI parser.
 */
@Controller({ path: 'search', version: API_VERSION.replace('v', '') })
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly suggestions: SearchSuggestionService,
    private readonly history: SearchHistoryService,
  ) {}

  @Get()
  @UserRateLimit({ bucket: 'search', max: 30, windowSeconds: 60 })
  unified(
    @Query() dto: UnifiedSearchDto,
    @CurrentUser() user: RequestUser,
  ): Promise<UnifiedSearchResponse> {
    return this.search.unified(dto, user);
  }

  @Get('problems')
  @UserRateLimit({ bucket: 'search', max: 30, windowSeconds: 60 })
  problems(
    @Query() dto: ProblemSearchDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SearchPage<ProblemSearchResult>> {
    return this.search.searchProblems(dto, user);
  }

  @Get('organizations')
  @UserRateLimit({ bucket: 'search', max: 30, windowSeconds: 60 })
  organizations(
    @Query() dto: OrganizationSearchDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SearchPage<OrganizationSearchResult>> {
    return this.search.searchOrganizations(dto, user);
  }

  @Get('knowledge')
  @UserRateLimit({ bucket: 'search', max: 30, windowSeconds: 60 })
  knowledge(
    @Query() dto: KnowledgeSearchDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SearchPage<KnowledgeSearchResult>> {
    return this.search.searchKnowledge(dto, user);
  }

  @Get('projects')
  @UserRateLimit({ bucket: 'search-projects', max: 60, windowSeconds: 60 })
  projects(
    @Query() dto: ProjectSearchDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SearchPage<ProjectSearchResult>> {
    return this.search.searchProjects(dto, user);
  }

  /** As-you-type suggestions: indexed prefix matches only, no embeddings, no AI. */
  @Get('suggest')
  @UserRateLimit({ bucket: 'search-suggest', max: 120, windowSeconds: 60 })
  suggest(
    @Query() dto: SuggestDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SearchSuggestions> {
    return this.suggestions.suggest(dto.q, user);
  }

  @Get('recent')
  async recent(@CurrentUser() user: RequestUser): Promise<{ items: string[] }> {
    return { items: await this.history.recent(user.id) };
  }

  @Delete('recent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearRecent(@CurrentUser() user: RequestUser): Promise<void> {
    await this.history.clear(user.id);
  }

  /** Anonymous daily counters — no query text. Platform administrators only. */
  @Get('metrics')
  @Roles('ADMIN')
  metrics(): Promise<SearchMetrics> {
    return this.history.metrics();
  }
}
