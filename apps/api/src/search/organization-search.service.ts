import { Injectable, Logger } from '@nestjs/common';
import type {
  OrganizationSearchResult,
  OrganizationType,
  ProblemCategory,
  SearchPage,
  SearchUnderstanding,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service.js';
import { toVectorLiteral } from '../problems/services/problem-embedding.store.js';
import { SearchAuthorizationService } from './search-authorization.service.js';
import { SearchCacheService, type CachedList } from './search-cache.service.js';
import { decodeSearchCursor, encodeSearchCursor } from './search-cursor.js';
import { highlightFields, searchTerms } from './search-highlight.js';
import type { ParsedFilters } from './search-query-parser.js';
import { SearchQueryUnderstandingService } from './search-query-understanding.service.js';
import {
  SearchRankingService,
  normaliseByMax,
  semanticScore,
} from './search-ranking.service.js';
import { ORGANIZATION_TSV, anyTerms, coverage } from './search-sql.js';
import type { OrganizationSearchDto } from './search.dto.js';

/** Organisation ranking: what it says, what it does, and whether it is verified. */
const WEIGHTS = {
  keyword: 0.45,
  semantic: 0.4,
  geographic: 0,
  recency: 0,
  community: 0.15,
};
const REASONS = { community: 'Verified, with matching expertise' };

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  type: OrganizationType;
  description: string | null;
  city: string | null;
  state: string | null;
  verificationStatus: string;
  logoUrl: string | null;
  expertise: ProblemCategory[];
  kw: number | null;
  coverage: number | null;
  similarity: number | null;
}

const human = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * Organisation search (Prompt 25): public profiles only — active, not
 * deleted, not suspended or rejected. Keyword over name, description and
 * place; semantic over the Prompt 14 organisation embeddings; expertise from
 * the existing taxonomy. Organisations are listed, not ranked against each
 * other for performance — order reflects relevance to the query only.
 */
@Injectable()
export class OrganizationSearchService {
  private readonly logger = new Logger(OrganizationSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly access: SearchAuthorizationService,
    private readonly understanding: SearchQueryUnderstandingService,
    private readonly ranking: SearchRankingService,
    private readonly retrieval: KnowledgeRetrievalService,
    private readonly cache: SearchCacheService,
  ) {}

  async search(
    dto: OrganizationSearchDto,
    user: RequestUser,
    preread?: {
      understanding: SearchUnderstanding;
      filters: ParsedFilters;
      text: string;
    } | null,
  ): Promise<SearchPage<OrganizationSearchResult>> {
    let text = dto.q ?? '';
    let understanding: SearchUnderstanding | null = null;
    let parsed: ParsedFilters = {};
    if (preread) {
      ({ understanding, text } = preread);
      parsed = preread.filters;
    } else if (dto.q && dto.interpret) {
      const r = await this.understanding.understand(dto.q, {
        userId: user.id,
        hasOrigin: false,
        allowAi: true,
        timezone: dto.timezone ?? this.config.analytics.timezone,
      });
      ({ understanding } = { understanding: r.view });
      parsed = r.parsed.filters;
      text = r.parsed.text;
    }
    const type = dto.organizationType ?? parsed.organizationType;
    const expertise = dto.expertise ?? parsed.category;
    const city = dto.city ?? parsed.city;

    const conditions: Prisma.Sql[] = [this.access.organizationPredicate()];
    if (type) conditions.push(Prisma.sql`o."type" = ${type}::"OrganizationType"`);
    if (dto.verified === true)
      conditions.push(Prisma.sql`o."verificationStatus" = 'VERIFIED'`);
    if (dto.verified === false)
      conditions.push(Prisma.sql`o."verificationStatus" = 'PENDING'`);
    if (expertise) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM organization_expertise x
        WHERE x."organizationId" = o.id AND x."category" = ${expertise}::"ProblemCategory")`);
    }
    if (city) conditions.push(Prisma.sql`lower(o."city") = lower(${city})`);
    if (dto.state) conditions.push(Prisma.sql`lower(o."state") = lower(${dto.state})`);
    const where = Prisma.join(conditions, ' AND ');

    const key = this.cache.key([
      'organizations',
      'public',
      text.toLowerCase(),
      type,
      expertise,
      city,
      dto.state,
      dto.verified,
    ]);
    const cursor = decodeSearchCursor(dto.cursor);
    if (cursor && (cursor.kind !== 'list' || cursor.key !== key)) {
      throw AppException.badRequest('That page cursor does not belong to this search.');
    }
    let list = await this.cache.get(key);
    if (!list) {
      list = await this.rank(text, where, expertise ?? null);
      await this.cache.set(key, list);
    }
    const offset = cursor?.kind === 'list' ? cursor.offset : 0;
    const slice = list.entries.slice(offset, offset + dto.limit);
    const rows = await this.rows(
      slice.map((e) => e.id),
      where,
      null,
      '',
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const terms = searchTerms(text);
    const next = offset + dto.limit;
    return {
      items: slice
        .map((e) => {
          const r = byId.get(e.id);
          return r ? this.toResult(r, terms, e.score, e.explanation) : null;
        })
        .filter((x): x is OrganizationSearchResult => x !== null),
      nextCursor:
        next < list.entries.length
          ? encodeSearchCursor({ kind: 'list', key, offset: next })
          : null,
      total: list.entries.length,
      match: list.match,
      understanding,
      signals: list.signals,
    };
  }

  private async rank(
    text: string,
    where: Prisma.Sql,
    expertise: ProblemCategory | null,
  ): Promise<CachedList> {
    const limit = this.config.search.candidateLimit;
    const signals = text.trim().length >= 2 ? ['keyword'] : ['filters'];
    let ids: string[];
    let vector: { literal: string; model: string } | null = null;
    let keywordIds = new Set<string>();

    if (text.trim().length < 2) {
      ids = (
        await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT o.id FROM organizations o WHERE ${where}
          ORDER BY (o."verificationStatus" = 'VERIFIED') DESC, o."name" ASC LIMIT ${limit}
        `)
      ).map((r) => r.id);
    } else {
      const keyword = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT o.id FROM organizations o
        WHERE ${ORGANIZATION_TSV} @@ ${anyTerms(text)} AND ${where}
        ORDER BY ts_rank_cd(${ORGANIZATION_TSV}, ${anyTerms(text)}, 32) DESC LIMIT ${limit}
      `);
      keywordIds = new Set(keyword.map((k) => k.id));
      let semantic: string[] = [];
      if (this.config.search.semanticEnabled) {
        try {
          const q = await this.retrieval.embedQuery(text.slice(0, 300));
          vector = { literal: toVectorLiteral(q.vector), model: q.model };
          semantic = (
            await this.prisma.$queryRaw<Array<{ id: string; sim: number }>>(Prisma.sql`
              SELECT o.id, (1 - (e."embedding" <=> ${vector.literal}::vector))::float8 AS sim
              FROM organization_embeddings e JOIN organizations o ON o.id = e."organizationId"
              WHERE e."modelName" = ${vector.model} AND e."embedding" IS NOT NULL AND ${where}
              ORDER BY e."embedding" <=> ${vector.literal}::vector LIMIT ${limit}
            `)
          )
            .filter((s) => s.sim >= this.config.search.semanticMinSimilarity)
            .map((s) => s.id);
          signals.push('semantic');
        } catch (error) {
          this.logger.warn(
            `semantic organisation search unavailable: ${(error as Error).message}`,
          );
        }
      }
      ids = [...new Set([...keyword.map((k) => k.id), ...semantic])];
    }
    if (ids.length === 0) return { entries: [], match: 'none', signals };

    const rows = await this.rows(ids, where, vector, text);
    const kw = normaliseByMax(rows.map((r) => (keywordIds.has(r.id) ? r.kw : null)));
    const hasText = text.trim().length >= 2;
    const floor = this.config.search.semanticMinSimilarity;
    const ranked = this.ranking.rank(
      rows.map((row, i) => ({ row, kw: kw[i] ?? null })),
      ({ row, kw: k }) => ({
        keyword: hasText ? (k === null ? 0 : 0.6 * k + 0.4 * (row.coverage ?? 0)) : null,
        semantic: vector ? (semanticScore(row.similarity, floor) ?? 0) : null,
        community:
          (row.verificationStatus === 'VERIFIED' ? 0.6 : 0) +
          (expertise && row.expertise.includes(expertise) ? 0.4 : 0),
      }),
      ({ row }) => row.name,
      WEIGHTS,
      REASONS,
    );
    return {
      entries: ranked.map((r) => ({
        id: r.item.row.id,
        score: r.score,
        explanation: r.explanation,
      })),
      match: !hasText || rows.some((r) => keywordIds.has(r.id)) ? 'exact' : 'related',
      signals,
    };
  }

  private rows(
    ids: string[],
    where: Prisma.Sql,
    vector: { literal: string; model: string } | null,
    text: string,
  ): Promise<OrgRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    const hasText = text.trim().length >= 2;
    return this.prisma.$queryRaw<OrgRow[]>(Prisma.sql`
      SELECT o.id, o.slug, o.name, o."type"::text AS type, o.description, o.city, o.state,
             o."verificationStatus"::text AS "verificationStatus", o."logoUrl",
             COALESCE((SELECT array_agg(x."category"::text ORDER BY x."category")
                       FROM organization_expertise x WHERE x."organizationId" = o.id), '{}') AS expertise,
             ${hasText ? Prisma.sql`ts_rank_cd(${ORGANIZATION_TSV}, ${anyTerms(text)}, 32)::float8` : Prisma.sql`NULL::float8`} AS kw,
             ${hasText ? coverage(ORGANIZATION_TSV, text) : Prisma.sql`NULL::float8`} AS coverage,
             ${
               vector
                 ? Prisma.sql`(SELECT (1 - (e."embedding" <=> ${vector.literal}::vector))::float8
                     FROM organization_embeddings e
                     WHERE e."organizationId" = o.id AND e."modelName" = ${vector.model}
                       AND e."embedding" IS NOT NULL LIMIT 1)`
                 : Prisma.sql`NULL::float8`
             } AS similarity
      FROM organizations o
      WHERE o.id = ANY(${ids}::uuid[]) AND ${where}
    `);
  }

  private toResult(
    row: OrgRow,
    terms: string[],
    score: number,
    explanation: string[],
  ): OrganizationSearchResult {
    const place = [row.city, row.state].filter(Boolean).join(', ');
    return {
      type: 'ORGANIZATION',
      id: row.slug,
      title: row.name,
      subtitle: [human(row.type), place || null].filter(Boolean).join(' · '),
      href: `/organizations/${encodeURIComponent(row.slug)}`,
      score,
      highlights: highlightFields(
        [
          { field: 'title', text: row.name },
          { field: 'description', text: row.description, excerpt: true },
        ],
        terms,
      ),
      explanation,
      metadata: {
        organizationType: row.type,
        verified: row.verificationStatus === 'VERIFIED',
        city: row.city,
        state: row.state,
        expertise: row.expertise,
        logoUrl: row.logoUrl,
      },
    };
  }
}
