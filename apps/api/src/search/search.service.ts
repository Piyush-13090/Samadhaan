import { Injectable } from '@nestjs/common';
import {
  SEARCH_MIN_QUERY_LENGTH,
  type KnowledgeSearchResult,
  type SearchPage,
  type SearchResult,
  type UnifiedSearchResponse,
} from '@samadhaan/shared';
import { isTimeZone } from '../analytics/analytics-time.js';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { KnowledgeSearchService } from './knowledge-search.service.js';
import { OrganizationSearchService } from './organization-search.service.js';
import { ProblemSearchService } from './problem-search.service.js';
import { ProjectSearchService } from './project-search.service.js';
import { SearchHistoryService } from './search-history.service.js';
import { SearchQueryUnderstandingService } from './search-query-understanding.service.js';
import type {
  KnowledgeSearchDto,
  OrganizationSearchDto,
  ProblemSearchDto,
  ProjectSearchDto,
  UnifiedSearchDto,
} from './search.dto.js';

const FILTER_KEYS = [
  'category',
  'subcategory',
  'severity',
  'urgency',
  'priority',
  'status',
  'verified',
  'resolved',
  'city',
  'state',
  'postalCode',
  'from',
  'to',
  'lat',
  'bbox',
  'organization',
  'office',
  'organizationType',
  'expertise',
  'projectId',
] as const; // fmt: keep

const empty = <T extends SearchResult>(): SearchPage<T> => ({
  items: [],
  nextCursor: null,
  total: 0,
  match: 'none',
  understanding: null,
  signals: [],
});

/**
 * Search orchestration (Prompt 25):
 *
 *   query → understanding (rules, AI fallback) → per-entity retrieval with the
 *   access policy inside SQL → ranking → normalised results
 *
 * The unified endpoint reads the query once and fans out to every entity in
 * parallel with small page sizes; each specialised endpoint pages one entity.
 * Each request records anonymous telemetry and, when the user submitted query
 * text, their bounded recent-search history.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly config: AppConfig,
    private readonly understanding: SearchQueryUnderstandingService,
    private readonly problems: ProblemSearchService,
    private readonly organizations: OrganizationSearchService,
    private readonly knowledge: KnowledgeSearchService,
    private readonly projects: ProjectSearchService,
    private readonly history: SearchHistoryService,
  ) {}

  async unified(
    dto: UnifiedSearchDto,
    user: RequestUser,
  ): Promise<UnifiedSearchResponse> {
    const started = Date.now();
    const q = dto.q ?? '';
    if (q.length < SEARCH_MIN_QUERY_LENGTH) {
      throw AppException.badRequest(
        `Type at least ${SEARCH_MIN_QUERY_LENGTH} characters to search.`,
      );
    }
    const timezone = dto.timezone ?? this.config.analytics.timezone;
    if (!isTimeZone(timezone))
      throw AppException.badRequest('timezone must be an IANA time zone.');

    const read = dto.interpret
      ? await this.understanding.understand(q, {
          userId: user.id,
          hasOrigin: dto.lat !== undefined && dto.lng !== undefined,
          allowAi: true,
          timezone,
        })
      : null;
    const preread = read
      ? { understanding: read.view, filters: read.parsed.filters, text: read.parsed.text }
      : { understanding: null as never, filters: {}, text: q };
    const small = { limit: 5, interpret: false, timezone };

    const [problems, organizations, knowledge, projects] = await Promise.all([
      this.problems.search(
        { ...dto, ...small, cursor: undefined } as ProblemSearchDto,
        user,
        preread,
      ),
      this.organizations.search(
        {
          ...small,
          q: dto.q,
          organizationType: dto.organizationType,
          city: dto.city,
        } as OrganizationSearchDto,
        user,
        preread,
      ),
      this.knowledge.search(
        { ...small, q: dto.q, category: dto.category } as KnowledgeSearchDto,
        user,
        preread,
      ),
      this.projects.search(
        { ...small, q: preread.text || dto.q } as ProjectSearchDto,
        user,
        preread,
      ),
    ]);
    const response: UnifiedSearchResponse = {
      query: q,
      understanding: read?.view ?? null,
      problems,
      organizations,
      knowledge,
      // Citizens have no project access; the section is omitted for them.
      projects: user.role === 'CITIZEN' && projects.items.length === 0 ? null : projects,
    };
    const count =
      problems.items.length +
      organizations.items.length +
      knowledge.items.length +
      (projects.items.length ?? 0);
    await this.after(
      user,
      dto,
      'ALL',
      count,
      started,
      problems.signals.includes('semantic'),
      read?.view.source === 'ai',
    );
    return response;
  }

  async searchProblems(dto: ProblemSearchDto, user: RequestUser) {
    const started = Date.now();
    const page = await this.problems.search(dto, user);
    await this.after(
      user,
      dto,
      'PROBLEM',
      page.items.length,
      started,
      page.signals.includes('semantic'),
      page.understanding?.source === 'ai',
    );
    return page;
  }

  async searchOrganizations(dto: OrganizationSearchDto, user: RequestUser) {
    const started = Date.now();
    const page = await this.organizations.search(dto, user);
    await this.after(
      user,
      dto,
      'ORGANIZATION',
      page.items.length,
      started,
      page.signals.includes('semantic'),
      page.understanding?.source === 'ai',
    );
    return page;
  }

  async searchKnowledge(dto: KnowledgeSearchDto, user: RequestUser) {
    const started = Date.now();
    const page =
      dto.q && dto.q.length >= SEARCH_MIN_QUERY_LENGTH
        ? await this.knowledge.search(dto, user)
        : empty<KnowledgeSearchResult>();
    await this.after(
      user,
      dto,
      'KNOWLEDGE',
      page.items.length,
      started,
      page.signals.includes('semantic'),
      false,
    );
    return page;
  }

  async searchProjects(dto: ProjectSearchDto, user: RequestUser) {
    const started = Date.now();
    const page = await this.projects.search(dto, user);
    await this.after(user, dto, 'PROJECT', page.items.length, started, false, false);
    return page;
  }

  private async after(
    user: RequestUser,
    dto: object,
    type: string,
    results: number,
    started: number,
    semantic: boolean,
    ai: boolean,
  ): Promise<void> {
    const record = dto as Record<string, unknown>;
    const filters = FILTER_KEYS.filter(
      (k) => record[k] !== undefined && record[k] !== '',
    );
    await this.history.record({
      type,
      results,
      latencyMs: Date.now() - started,
      semantic,
      ai,
      filters,
    });
    // A first page with text the user submitted — not a page turn.
    if (typeof record.q === 'string' && !record.cursor)
      await this.history.remember(user.id, record.q);
  }
}
