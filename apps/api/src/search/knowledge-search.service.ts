import { Injectable, Logger } from '@nestjs/common';
import type {
  KnowledgeSearchResult,
  ProblemCategory,
  SearchPage,
  SearchUnderstanding,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { KnowledgeScope } from '../knowledge/knowledge-access.service.js';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service.js';
import { SearchAuthorizationService } from './search-authorization.service.js';
import { excerpt, highlight, searchTerms } from './search-highlight.js';
import type { ParsedFilters } from './search-query-parser.js';
import { SearchQueryUnderstandingService } from './search-query-understanding.service.js';
import { anyTerms } from './search-sql.js';
import type { KnowledgeSearchDto } from './search.dto.js';

interface Passage {
  chunkId: string;
  sourceId: string;
  title: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  content: string;
  sourceType: string;
  categories: string[];
  score: number;
  semantic: number;
  keyword: number;
}

const MAX_PER_SOURCE = 2;

/**
 * Knowledge search (Prompt 25), over the Prompt 20 knowledge base with its
 * own visibility predicate: public sources for everyone; an office's or
 * organisation's sources for its members; private sources for their
 * uploader; a project's sources only when the caller proves participation
 * (`projectId`, checked by the knowledge access service).
 *
 * Retrieval is the RAG hybrid retriever. If embeddings are unavailable, a
 * keyword-only query with the same predicate answers instead. Returned
 * sources are re-checked against the predicate before anything is shown.
 */
@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly access: SearchAuthorizationService,
    private readonly retrieval: KnowledgeRetrievalService,
    private readonly understanding: SearchQueryUnderstandingService,
  ) {}

  async search(
    dto: KnowledgeSearchDto,
    user: RequestUser,
    preread?: {
      understanding: SearchUnderstanding;
      filters: ParsedFilters;
      text: string;
    } | null,
  ): Promise<SearchPage<KnowledgeSearchResult>> {
    const scope = await this.access.knowledgeScope(user, dto.projectId ?? null);
    let text = dto.q ?? '';
    let understanding: SearchUnderstanding | null = null;
    let category: ProblemCategory | undefined = dto.category;
    if (preread) {
      understanding = preread.understanding;
      category ??= preread.filters.category;
      // Knowledge reads better with the whole question than with the leftovers.
      text = dto.q ?? preread.text;
    } else if (dto.q && dto.interpret) {
      const r = await this.understanding.understand(dto.q, {
        userId: user.id,
        hasOrigin: false,
        allowAi: false,
        timezone: dto.timezone ?? this.config.analytics.timezone,
      });
      understanding = r.view;
      category ??= r.parsed.filters.category;
    }
    if (text.trim().length < 2) {
      return {
        items: [],
        nextCursor: null,
        total: 0,
        match: 'none',
        understanding,
        signals: [],
      };
    }

    const topK = Math.min(dto.limit, 20);
    let passages: Passage[];
    const signals: string[] = [];
    try {
      const result = await this.retrieval.retrieve({
        semanticQuery: text,
        keywordQuery: text,
        scope,
        context: { kind: 'GENERAL', category: category ?? null, city: null },
        topK: topK * 2,
      });
      passages = result.passages.map((p) => ({
        chunkId: p.chunkId,
        sourceId: p.sourceId,
        title: p.title,
        sectionTitle: p.sectionTitle,
        pageNumber: p.pageNumber,
        content: p.content,
        sourceType: p.sourceType,
        categories: p.categories,
        score: p.score,
        semantic: p.signals.semantic,
        keyword: p.signals.keyword,
      }));
      signals.push('keyword', 'semantic');
    } catch (error) {
      this.logger.warn(
        `knowledge retrieval unavailable, keyword only: ${(error as Error).message}`,
      );
      passages = await this.keywordOnly(text, scope, topK * 2);
      signals.push('keyword');
    }

    if (category) {
      passages = passages.filter(
        (p) => p.categories.length === 0 || p.categories.includes(category!),
      );
    }
    // A few passages per source, so one long document cannot fill the page.
    const perSource = new Map<string, number>();
    passages = passages.filter((p) => {
      const n = (perSource.get(p.sourceId) ?? 0) + 1;
      perSource.set(p.sourceId, n);
      return n <= MAX_PER_SOURCE;
    });

    // Defence in depth: only sources the predicate allows, read now.
    const sourceIds = [...new Set(passages.map((p) => p.sourceId))];
    const visible = sourceIds.length
      ? await this.prisma.$queryRaw<Array<{ id: string; visibility: string }>>(Prisma.sql`
          SELECT s.id, s."visibility"::text AS visibility FROM knowledge_sources s
          WHERE s.id = ANY(${sourceIds}::uuid[]) AND s."status" = 'COMPLETED'
            AND ${this.access.knowledgePredicate(scope)}
        `)
      : [];
    const visibility = new Map(visible.map((v) => [v.id, v.visibility]));
    const terms = searchTerms(text);
    const items = passages
      .filter((p) => visibility.has(p.sourceId))
      .slice(0, topK)
      .map((p): KnowledgeSearchResult => {
        const explanation: string[] = [];
        if (p.keyword > 0) explanation.push('Matches your words');
        if (p.semantic >= 0.5) explanation.push('Similar in meaning');
        return {
          type: 'KNOWLEDGE',
          id: p.chunkId,
          title: p.title,
          subtitle:
            [p.sectionTitle, p.pageNumber ? `page ${p.pageNumber}` : null]
              .filter(Boolean)
              .join(' · ') || null,
          href: `/knowledge/sources/${p.sourceId}#chunk-${p.chunkId}`,
          score: Math.round(p.score * 1000) / 1000,
          highlights: [
            { field: 'title', segments: highlight(p.title, terms) },
            {
              field: 'excerpt',
              segments: highlight(excerpt(p.content, terms, 240), terms),
            },
          ],
          explanation,
          metadata: {
            sourceId: p.sourceId,
            sourceType: p.sourceType,
            sectionTitle: p.sectionTitle,
            pageNumber: p.pageNumber,
            visibility: visibility.get(p.sourceId)!,
          },
        };
      });
    return {
      items,
      nextCursor: null,
      total: items.length,
      match:
        items.length === 0
          ? 'none'
          : items.some((i) => i.explanation.includes('Matches your words'))
            ? 'exact'
            : 'related',
      understanding,
      signals,
    };
  }

  private async keywordOnly(
    text: string,
    scope: KnowledgeScope,
    limit: number,
  ): Promise<Passage[]> {
    const rows = await this.prisma.$queryRaw<
      Array<Omit<Passage, 'semantic' | 'keyword'> & { rank: number }>
    >(Prisma.sql`
      SELECT c.id AS "chunkId", c."sourceId", s."title", c."sectionTitle", c."pageNumber", c."content",
             s."sourceType"::text AS "sourceType", s."categories"::text[] AS categories,
             ts_rank_cd(c."contentVector", ${anyTerms(text)}, 32)::float8 AS rank
      FROM knowledge_chunks c JOIN knowledge_sources s ON s.id = c."sourceId"
      WHERE s."status" = 'COMPLETED' AND ${this.access.knowledgePredicate(scope)}
        AND c."contentVector" @@ ${anyTerms(text)}
      ORDER BY rank DESC LIMIT ${limit}
    `);
    const max = Math.max(0, ...rows.map((r) => r.rank));
    return rows.map(({ rank, ...r }) => ({
      ...r,
      score: max > 0 ? rank / max : 0,
      semantic: 0,
      keyword: rank,
    }));
  }
}
