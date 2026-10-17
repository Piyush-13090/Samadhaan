import { Injectable, Logger } from '@nestjs/common';
import type {
  PriorityTier,
  ProblemCategory,
  ProblemSearchResult,
  ProblemSeverity,
  ProblemStatus,
  ProblemUrgency,
  SearchPage,
  SearchUnderstanding,
} from '@samadhaan/shared';
import { addDays, isTimeZone, zonedMidnight } from '../analytics/analytics-time.js';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service.js';
import { toVectorLiteral } from '../problems/services/problem-embedding.store.js';
import { SearchAuthorizationService } from './search-authorization.service.js';
import {
  SearchCacheService,
  type CachedEntry,
  type CachedList,
} from './search-cache.service.js';
import { decodeSearchCursor, encodeSearchCursor } from './search-cursor.js';
import { highlightFields, searchTerms } from './search-highlight.js';
import type { ParsedFilters } from './search-query-parser.js';
import { SearchQueryUnderstandingService } from './search-query-understanding.service.js';
import {
  SearchRankingService,
  communityScore,
  geographicScore,
  normaliseByMax,
  recencyScore,
  semanticScore,
  type Signals,
} from './search-ranking.service.js';
import {
  EFFECTIVE_TIER,
  PROBLEM_TSV,
  SEVERITY_RANK,
  SUMMARY_TSV,
  TIER_RANK,
  anyTerms,
  coverage,
} from './search-sql.js';
import type { ProblemSearchDto } from './search.dto.js';

const DEFAULT_RADIUS_KM = 5;
const HIDDEN_BY_DEFAULT = ['REJECTED', 'ARCHIVED', 'DUPLICATE'];
const OPEN = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'IN_PROGRESS'];

type Preread = {
  understanding: SearchUnderstanding;
  filters: ParsedFilters;
  text: string;
};

interface Effective extends ParsedFilters {
  subcategory?: string;
  state?: string;
  organization?: string;
}

interface DetailRow {
  id: string;
  publicId: string;
  title: string;
  description: string;
  subcategory: string | null;
  category: ProblemCategory;
  status: ProblemStatus;
  severity: ProblemSeverity;
  urgency: ProblemUrgency;
  tier: PriorityTier | null;
  address: string | null;
  city: string | null;
  state: string | null;
  voteCount: number;
  createdAt: Date;
  ageDays: number;
  distance: number | null;
  similarity: number | null;
  coverage: number | null;
  summary: string | null;
}

const human = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * Problem search (Prompt 25): keyword (PostgreSQL full text), semantic
 * (pgvector over existing problem embeddings), structured filters and
 * PostGIS, combined by `SearchRankingService`.
 *
 * Every query includes the access policy, so nothing the caller may not see
 * is ever retrieved. Candidate sets are bounded (SEARCH_CANDIDATE_LIMIT per
 * channel); with query text the ranked list is cached and paged by cursor,
 * and without text SQL pages directly on the sort key.
 */
@Injectable()
export class ProblemSearchService {
  private readonly logger = new Logger(ProblemSearchService.name);

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
    dto: ProblemSearchDto,
    user: RequestUser,
    preread?: Preread | null,
  ): Promise<SearchPage<ProblemSearchResult>> {
    const page = await this.run(dto, user, preread);
    // Zero results because of filters read from the words (not ones the user
    // chose)? Search the plain text once more and say these are related.
    const inferred = (page.understanding?.applied.length ?? 0) > 0;
    if (
      page.items.length === 0 &&
      !dto.cursor &&
      inferred &&
      dto.q &&
      dto.q.length >= 2
    ) {
      const relaxed = await this.run(
        { ...dto, interpret: false } as ProblemSearchDto,
        user,
        null,
      );
      if (relaxed.items.length > 0) {
        return {
          ...relaxed,
          match: 'related',
          understanding: page.understanding,
          nextCursor: null,
        };
      }
    }
    return page;
  }

  private async run(
    dto: ProblemSearchDto,
    user: RequestUser,
    preread?: Preread | null,
  ): Promise<SearchPage<ProblemSearchResult>> {
    const timezone = dto.timezone ?? this.config.analytics.timezone;
    if (!isTimeZone(timezone))
      throw AppException.badRequest('timezone must be an IANA time zone.');
    const origin =
      dto.lat !== undefined && dto.lng !== undefined
        ? { lat: dto.lat, lng: dto.lng }
        : null;
    if ((dto.lat === undefined) !== (dto.lng === undefined)) {
      throw AppException.badRequest('lat and lng must be given together.');
    }

    // --- understanding: words → filters, explicit parameters win ----------------
    let text = dto.q ?? '';
    let understanding: SearchUnderstanding | null = null;
    let parsed: ParsedFilters = {};
    if (preread) {
      ({ understanding, text } = preread);
      parsed = preread.filters;
    } else if (dto.q && dto.interpret) {
      const result = await this.understanding.understand(dto.q, {
        userId: user.id,
        hasOrigin: origin !== null,
        allowAi: true,
        timezone,
      });
      understanding = result.view;
      parsed = result.parsed.filters;
      text = result.parsed.text;
    }
    const f: Effective = {
      ...parsed,
      ...strip({
        category: dto.category,
        subcategory: dto.subcategory,
        severity: dto.severity,
        urgency: dto.urgency,
        priority: dto.priority,
        status: dto.status,
        verified: dto.verified,
        resolved: dto.resolved,
        city: dto.city,
        state: dto.state,
        postalCode: dto.postalCode,
        from: dto.from,
        to: dto.to,
        radiusKm: dto.radiusKm,
        organization: dto.organization,
      }),
    };
    const radiusM = origin ? (f.radiusKm ?? DEFAULT_RADIUS_KM) * 1000 : null;
    if (dto.sort === 'nearest' && !origin) {
      throw AppException.badRequest('Sorting by nearest needs a location (lat and lng).');
    }

    // --- scope: the policy, plus an official's own jurisdiction if asked ---------
    let scopeKey = 'public';
    const conditions: Prisma.Sql[] = [this.access.problemPredicate()];
    if (dto.office) {
      const office = await this.access.office(dto.office, user);
      conditions.push(office.jurisdiction.condition);
      scopeKey = `office:${office.organization.id}:${SearchAuthorizationService.fingerprint(office.jurisdiction.condition)}`;
    }
    conditions.push(...this.filterConditions(f, timezone, origin, radiusM, dto.bbox));
    const where = Prisma.join(conditions, ' AND ');
    const originSql = origin
      ? Prisma.sql`ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography`
      : null;

    const terms = searchTerms(text);
    const base = { understanding };
    if (text.trim().length < 2) {
      return { ...(await this.browse(dto, where, originSql, terms)), ...base };
    }

    // --- ranked candidate list (cached, paged by cursor) -------------------------
    const key = this.cache.key([
      'problems',
      scopeKey,
      text.toLowerCase(),
      f,
      origin,
      radiusM,
      dto.bbox ?? null,
      dto.sort,
      timezone,
    ]);
    const cursor = decodeSearchCursor(dto.cursor);
    if (cursor && (cursor.kind !== 'list' || cursor.key !== key)) {
      throw AppException.badRequest('That page cursor does not belong to this search.');
    }
    let list = await this.cache.get(key);
    if (!list) {
      list = await this.rankCandidates(text, where, originSql, radiusM, dto.sort);
      await this.cache.set(key, list);
    }

    const offset = cursor?.kind === 'list' ? cursor.offset : 0;
    const slice = list.entries.slice(offset, offset + dto.limit);
    const rows = await this.details(
      slice.map((e) => e.id),
      where,
      originSql,
      null,
      text,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = slice
      .map((entry) => {
        const row = byId.get(entry.id);
        return row ? this.toResult(row, terms, entry) : null;
      })
      .filter((x): x is ProblemSearchResult => x !== null);
    const next = offset + dto.limit;
    return {
      ...base,
      items,
      nextCursor:
        next < list.entries.length
          ? encodeSearchCursor({ kind: 'list', key, offset: next })
          : null,
      total: list.entries.length,
      match: list.match,
      signals: list.signals,
    };
  }

  // ------------------------------------------------------------------ filters

  private filterConditions(
    f: Effective,
    timezone: string,
    origin: { lat: number; lng: number } | null,
    radiusM: number | null,
    bbox: string | undefined,
  ): Prisma.Sql[] {
    const c: Prisma.Sql[] = [];
    if (f.category) c.push(Prisma.sql`p."category" = ${f.category}::"ProblemCategory"`);
    if (f.subcategory)
      c.push(Prisma.sql`lower(trim(p."subcategory")) = lower(${f.subcategory})`);
    if (f.severity) c.push(Prisma.sql`p."severity" = ${f.severity}::"ProblemSeverity"`);
    if (f.urgency) c.push(Prisma.sql`p."urgency" = ${f.urgency}::"ProblemUrgency"`);
    if (f.priority) c.push(Prisma.sql`${EFFECTIVE_TIER} = ${f.priority}::"PriorityTier"`);
    if (f.status) c.push(Prisma.sql`p."status" = ${f.status}::"ProblemStatus"`);
    if (f.verified === true)
      c.push(Prisma.sql`p."status" IN ('VERIFIED','IN_PROGRESS','RESOLVED')`);
    if (f.verified === false)
      c.push(Prisma.sql`p."status" IN ('SUBMITTED','UNDER_REVIEW')`);
    if (f.resolved === true) c.push(Prisma.sql`p."status" = 'RESOLVED'`);
    if (f.resolved === false)
      c.push(Prisma.sql`p."status" = ANY(${OPEN}::"ProblemStatus"[])`);
    if (!f.status && f.verified === undefined && f.resolved === undefined) {
      c.push(Prisma.sql`p."status" <> ALL(${HIDDEN_BY_DEFAULT}::"ProblemStatus"[])`);
    }
    if (f.city) c.push(Prisma.sql`lower(p."city") = lower(${f.city})`);
    if (f.state) c.push(Prisma.sql`lower(p."state") = lower(${f.state})`);
    if (f.postalCode) {
      c.push(
        Prisma.sql`upper(replace(p."postalCode", ' ', '')) = upper(replace(${f.postalCode}, ' ', ''))`,
      );
    }
    if (f.from) {
      if (!isDate(f.from)) throw AppException.badRequest('from must be a real date.');
      c.push(Prisma.sql`p."createdAt" >= ${zonedMidnight(f.from, timezone)}`);
    }
    if (f.to) {
      if (!isDate(f.to)) throw AppException.badRequest('to must be a real date.');
      c.push(Prisma.sql`p."createdAt" < ${zonedMidnight(addDays(f.to, 1), timezone)}`);
    }
    if (f.from && f.to && f.from > f.to)
      throw AppException.badRequest('from must not be after to.');
    if (origin && radiusM) {
      c.push(
        Prisma.sql`ST_DWithin(p."location", ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography, ${radiusM})`,
      );
    }
    if (bbox) {
      const [w, s, e, n] = bbox.split(',').map(Number) as [
        number,
        number,
        number,
        number,
      ];
      if (
        !(w < e && s < n && w >= -180 && e <= 180 && s >= -90 && n <= 90) ||
        e - w > 5 ||
        n - s > 5
      ) {
        throw AppException.badRequest('bbox must be a valid box no wider than 5°.');
      }
      c.push(
        Prisma.sql`p."location" && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geography`,
      );
    }
    if (f.organization) {
      c.push(Prisma.sql`EXISTS (
        SELECT 1 FROM problem_allocations pa
        JOIN organizations o ON o.id = pa."organizationId"
        WHERE pa."problemId" = p.id AND pa.status = 'ACCEPTED' AND o.slug = ${f.organization}
          AND o."deletedAt" IS NULL AND o."isActive" = true
          AND o."verificationStatus" IN ('VERIFIED','PENDING')
      )`);
    }
    return c;
  }

  // --------------------------------------------------------------- retrieval

  private async rankCandidates(
    text: string,
    where: Prisma.Sql,
    origin: Prisma.Sql | null,
    radiusM: number | null,
    sort: ProblemSearchDto['sort'],
  ): Promise<CachedList> {
    const limit = this.config.search.candidateLimit;
    const keyword = await this.prisma.$queryRaw<
      Array<{ id: string; kw: number }>
    >(Prisma.sql`
      WITH q AS (SELECT ${anyTerms(text)} AS tsq)
      SELECT id, max(kw)::float8 AS kw FROM (
        (SELECT p.id, ts_rank_cd(${PROBLEM_TSV}, q.tsq, 32) AS kw
         FROM problems p, q
         WHERE q.tsq IS NOT NULL AND ${PROBLEM_TSV} @@ q.tsq AND ${where}
         ORDER BY kw DESC LIMIT ${limit})
        UNION ALL
        (SELECT p.id, 0.5 * ts_rank_cd(${SUMMARY_TSV}, q.tsq, 32)
         FROM problem_ai_analyses a JOIN problems p ON p.id = a."problemId", q
         WHERE q.tsq IS NOT NULL AND a."processingStatus" = 'COMPLETED'
           AND ${SUMMARY_TSV} @@ q.tsq AND ${where}
         LIMIT ${limit})
      ) hits GROUP BY id
    `);

    const signals = ['keyword'];
    let vector: { literal: string; model: string } | null = null;
    let semantic: Array<{ id: string; sim: number }> = [];
    if (this.config.search.semanticEnabled) {
      try {
        const q = await this.retrieval.embedQuery(text.slice(0, 300));
        vector = { literal: toVectorLiteral(q.vector), model: q.model };
        semantic = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = 100`);
          await tx.$executeRawUnsafe(`SET LOCAL hnsw.iterative_scan = relaxed_order`);
          return tx.$queryRaw<Array<{ id: string; sim: number }>>(Prisma.sql`
            SELECT e."problemId" AS id, (1 - (e."embedding" <=> ${vector!.literal}::vector))::float8 AS sim
            FROM problem_embeddings e JOIN problems p ON p.id = e."problemId"
            WHERE e."embeddingType" = 'TEXT' AND e."modelName" = ${vector!.model}
              AND e."embedding" IS NOT NULL AND ${where}
            ORDER BY e."embedding" <=> ${vector!.literal}::vector
            LIMIT ${limit}
          `);
        });
        semantic = semantic.filter(
          (s) => s.sim >= this.config.search.semanticMinSimilarity,
        );
        signals.push('semantic');
      } catch (error) {
        // Keyword search still works without the embedding service.
        this.logger.warn(`semantic search unavailable: ${(error as Error).message}`);
      }
    }
    if (origin) signals.push('geographic');

    const keywordIds = new Set(keyword.map((k) => k.id));
    const ids = [...new Set([...keyword.map((k) => k.id), ...semantic.map((s) => s.id)])];
    if (ids.length === 0) return { entries: [], match: 'none', signals };
    const rows = await this.details(ids, where, origin, vector, text);

    const raw = new Map(keyword.map((k) => [k.id, k.kw]));
    const normalised = normaliseByMax(rows.map((r) => raw.get(r.id) ?? null));
    const halfLife = this.config.search.recencyHalfLifeDays;
    const floor = this.config.search.semanticMinSimilarity;
    const ranked = this.ranking.rank(
      rows.map((row, i) => ({ row, kw: normalised[i] ?? null })),
      ({ row, kw }): Signals => ({
        keyword: kw === null ? 0 : 0.6 * kw + 0.4 * (row.coverage ?? 0),
        semantic: vector ? (semanticScore(row.similarity, floor) ?? 0) : null,
        geographic: geographicScore(row.distance, radiusM),
        recency: recencyScore(row.ageDays, halfLife),
        community: communityScore(row.voteCount),
      }),
      ({ row }) => row.publicId,
    );

    let ordered = ranked;
    if (sort !== 'relevance') {
      const value = (r: DetailRow): number => {
        const t = new Date(r.createdAt).getTime();
        switch (sort) {
          case 'newest':
            return t;
          case 'oldest':
            return -t;
          case 'priority':
            return tierRank(r.tier) * 1e13 + t;
          case 'severity':
            return severityRank(r.severity) * 1e13 + t;
          case 'supported':
            return r.voteCount * 1e13 + t;
          case 'nearest':
            return -(r.distance ?? Number.POSITIVE_INFINITY);
          default:
            return 0;
        }
      };
      ordered = [...ranked].sort(
        (a, b) =>
          value(b.item.row) - value(a.item.row) ||
          a.item.row.publicId.localeCompare(b.item.row.publicId),
      );
    }

    const entries: CachedEntry[] = ordered.map((r) => ({
      id: r.item.row.id,
      score: r.score,
      explanation: r.explanation,
    }));
    return {
      entries,
      match: rows.some((r) => keywordIds.has(r.id)) ? 'exact' : 'related',
      signals,
    };
  }

  /** Public fields for a set of ids — re-checked against `where`. */
  private details(
    ids: string[],
    where: Prisma.Sql,
    origin: Prisma.Sql | null,
    vector: { literal: string; model: string } | null,
    text: string,
  ): Promise<DetailRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    const similarity = vector
      ? Prisma.sql`(SELECT (1 - (e."embedding" <=> ${vector.literal}::vector))::float8
           FROM problem_embeddings e
           WHERE e."problemId" = p.id AND e."embeddingType" = 'TEXT'
             AND e."modelName" = ${vector.model} AND e."embedding" IS NOT NULL LIMIT 1)`
      : Prisma.sql`NULL::float8`;
    return this.prisma.$queryRaw<DetailRow[]>(Prisma.sql`
      SELECT p.id, p."publicId", p."title", p."description", p."subcategory",
             p."category"::text AS category, p."status"::text AS status,
             p."severity"::text AS severity, p."urgency"::text AS urgency,
             ${EFFECTIVE_TIER}::text AS tier,
             p."address", p."city", p."state", p."voteCount", p."createdAt",
             (EXTRACT(EPOCH FROM (${new Date()} - p."createdAt")) / 86400.0)::float8 AS "ageDays",
             ${origin ? Prisma.sql`ST_Distance(p."location", ${origin})::float8` : Prisma.sql`NULL::float8`} AS distance,
             ${similarity} AS similarity,
             ${text.trim() ? coverage(PROBLEM_TSV, text) : Prisma.sql`NULL::float8`} AS coverage,
             (SELECT a."summary" FROM problem_ai_analyses a
               WHERE a."problemId" = p.id AND a."processingStatus" = 'COMPLETED' AND a."summary" IS NOT NULL
               ORDER BY a."createdAt" DESC LIMIT 1) AS summary
      FROM problems p
      WHERE p.id = ANY(${ids}::uuid[]) AND ${where}
    `);
  }

  // ------------------------------------------------------------------ browse

  /** No query text: SQL pages directly on the sort key (keyset, no OFFSET). */
  private async browse(
    dto: ProblemSearchDto,
    where: Prisma.Sql,
    origin: Prisma.Sql | null,
    terms: string[],
  ): Promise<Omit<SearchPage<ProblemSearchResult>, 'understanding'>> {
    const sort = dto.sort === 'relevance' ? (origin ? 'nearest' : 'newest') : dto.sort;
    const epoch = Prisma.sql`EXTRACT(EPOCH FROM p."createdAt")`;
    const expr = {
      newest: Prisma.sql`${epoch}`,
      oldest: Prisma.sql`(-${epoch})`,
      priority: Prisma.sql`(${TIER_RANK} * 1e10 + ${epoch})`,
      severity: Prisma.sql`(${SEVERITY_RANK} * 1e10 + ${epoch})`,
      supported: Prisma.sql`(p."voteCount"::float8 * 1e10 + ${epoch})`,
      nearest: origin
        ? Prisma.sql`(-ST_Distance(p."location", ${origin}))`
        : Prisma.sql`${epoch}`,
    }[sort];
    const value = Prisma.sql`(${expr})::float8`;
    const cursor = decodeSearchCursor(dto.cursor);
    if (cursor && cursor.kind !== 'keyset')
      throw AppException.badRequest('That page cursor does not belong to this search.');
    const keyset = cursor
      ? Prisma.sql`AND (${value} < ${cursor.value}::float8 OR (${value} = ${cursor.value}::float8 AND p."publicId" > ${cursor.id}))`
      : Prisma.empty;

    const page = await this.prisma.$queryRaw<
      Array<{ id: string; sortValue: number; publicId: string }>
    >(Prisma.sql`
      SELECT p.id, p."publicId", ${value} AS "sortValue"
      FROM problems p
      WHERE ${where} ${keyset}
      ORDER BY ${value} DESC, p."publicId" ASC
      LIMIT ${dto.limit + 1}
    `);
    const visible = page.slice(0, dto.limit);
    const rows = await this.details(
      visible.map((r) => r.id),
      where,
      origin,
      null,
      '',
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const last = visible.at(-1);
    return {
      items: visible
        .map((r) => byId.get(r.id))
        .filter((r): r is DetailRow => r !== undefined)
        .map((row) => this.toResult(row, terms, null)),
      nextCursor:
        page.length > dto.limit && last
          ? encodeSearchCursor({
              kind: 'keyset',
              value: Number(last.sortValue),
              id: last.publicId,
            })
          : null,
      total: null,
      match: visible.length > 0 ? 'exact' : 'none',
      signals: origin ? ['filters', 'geographic'] : ['filters'],
    };
  }

  // ------------------------------------------------------------------ output

  private toResult(
    row: DetailRow,
    terms: string[],
    entry: CachedEntry | null,
  ): ProblemSearchResult {
    const place = [row.city, row.state].filter(Boolean).join(', ');
    return {
      type: 'PROBLEM',
      id: row.publicId,
      title: row.title,
      subtitle: [human(row.category), row.subcategory, place || null]
        .filter(Boolean)
        .join(' · '),
      href: `/problems/${encodeURIComponent(row.publicId)}`,
      score: entry?.score ?? 0,
      highlights: highlightFields(
        [
          { field: 'title', text: row.title },
          { field: 'description', text: row.description, excerpt: true },
          { field: 'summary', text: row.summary, excerpt: true },
          { field: 'address', text: row.address },
        ],
        terms,
      ),
      explanation: entry?.explanation ?? [],
      metadata: {
        category: row.category,
        subcategory: row.subcategory,
        status: row.status,
        severity: row.severity,
        urgency: row.urgency,
        priority: row.tier,
        city: row.city,
        state: row.state,
        voteCount: row.voteCount,
        createdAt: new Date(row.createdAt).toISOString(),
        distanceKm: row.distance === null ? null : Math.round(row.distance / 100) / 10,
      },
    };
  }
}

function strip<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;
}

function isDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m! - 1 &&
    date.getUTCDate() === d
  );
}

const tierRank = (t: PriorityTier | null) =>
  t === 'CRITICAL' ? 4 : t === 'HIGH' ? 3 : t === 'MEDIUM' ? 2 : t === 'LOW' ? 1 : 0;
const severityRank = (s: ProblemSeverity) =>
  s === 'CRITICAL' ? 4 : s === 'HIGH' ? 3 : s === 'MEDIUM' ? 2 : 1;

export { strip as stripUndefined };
