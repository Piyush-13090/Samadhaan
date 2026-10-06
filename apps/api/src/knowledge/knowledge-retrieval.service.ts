import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_DIMENSIONS } from '@samadhaan/shared';
import { AiService } from '../ai/ai.service.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  parseVectorLiteral,
  toVectorLiteral,
} from '../problems/services/problem-embedding.store.js';
import { RedisService } from '../redis/redis.service.js';
import {
  KnowledgeAccessService,
  type KnowledgeScope,
} from './knowledge-access.service.js';
import {
  RETRIEVAL_VERSION,
  diversify,
  score,
  type Candidate,
  type RetrievalContext,
  type Scored,
} from './scoring.js';

export interface RetrievalRequest {
  /** What is embedded: the question, enriched with problem/project context. */
  semanticQuery: string;
  /** What is keyword-matched: the question itself. */
  keywordQuery: string;
  scope: KnowledgeScope;
  context: RetrievalContext;
  topK?: number;
}

export interface RetrievalResult {
  passages: Scored[];
  candidates: number;
  /** Best semantic similarity was below the "weak" line. */
  weak: boolean;
  embeddingModel: string;
  embeddingVersion: string;
  retrievalVersion: string;
  ms: number;
}

export class RetrievalUnavailableError extends Error {}

/** A passage that shares at least this share of the query's terms is relevant on keywords alone. */
export const KEYWORD_COVERAGE_GATE = 0.5;

/**
 * Hybrid retrieval over pgvector and PostgreSQL full-text search (Prompt 20).
 *
 *   query ─▶ embedding (AI service; cached) ─▶ one SQL statement:
 *            top-N by cosine distance (HNSW)  ∪  top-M by full-text rank
 *            — both under the caller's access predicate —
 *          ─▶ hybrid score in TypeScript over those ≤ N+M rows ─▶ threshold
 *          ─▶ diversity re-rank (MMR) ─▶ top-K
 *
 * Nothing outside the predicate is ever read: authorisation happens in the
 * WHERE clause, not after. Chunks are compared only with a query embedded by
 * the same model.
 */
@Injectable()
export class KnowledgeRetrievalService {
  private readonly logger = new Logger(KnowledgeRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly access: KnowledgeAccessService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const settings = this.config.rag;
    const started = Date.now();
    const query = await this.embedQuery(request.semanticQuery);
    const keyword = request.keywordQuery.slice(0, 500);
    const predicate = this.access.predicate(request.scope);
    const vector = toVectorLiteral(query.vector);
    const keywordLimit = Math.max(5, Math.floor(settings.candidates / 2));

    const rows = await this.prisma.$transaction(async (tx) => {
      // Filtered HNSW search: iterative scans keep returning rows until the
      // LIMIT is met after filtering (pgvector ≥ 0.8), instead of silently
      // returning fewer.
      await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = 100`);
      await tx.$executeRawUnsafe(`SET LOCAL hnsw.iterative_scan = relaxed_order`);
      return tx.$queryRaw<
        Array<{
          id: string;
          documentId: string;
          sourceId: string;
          content: string;
          sectionTitle: string | null;
          pageNumber: number | null;
          title: string;
          sourceType: Candidate['sourceType'];
          categories: string[];
          city: string | null;
          updatedAt: Date;
          semantic: number;
          keyword: number;
          embedding: string;
        }>
      >(Prisma.sql`
        WITH q AS (
          -- Any query term may match (OR): a natural-language question
          -- rarely contains every word of the passage that answers it.
          SELECT ${vector}::vector AS v,
                 replace(plainto_tsquery('english', ${keyword})::text, ' & ', ' | ')::tsquery AS tsq,
                 tsvector_to_array(to_tsvector('english', ${keyword})) AS terms
        ),
        vec AS (
          SELECT c.id
          FROM knowledge_chunks c
          JOIN knowledge_sources s ON s.id = c."sourceId", q
          WHERE s."status" = 'COMPLETED'
            AND c."embeddingModel" = ${query.model}
            AND c."embedding" IS NOT NULL
            AND ${predicate}
          ORDER BY c."embedding" <=> q.v
          LIMIT ${settings.candidates}
        ),
        kw AS (
          SELECT c.id
          FROM knowledge_chunks c
          JOIN knowledge_sources s ON s.id = c."sourceId", q
          WHERE s."status" = 'COMPLETED'
            AND c."embeddingModel" = ${query.model}
            AND ${predicate}
            AND to_tsvector('english', c."content") @@ q.tsq
          ORDER BY ts_rank_cd(to_tsvector('english', c."content"), q.tsq, 32) DESC
          LIMIT ${keywordLimit}
        ),
        ids AS (SELECT id FROM vec UNION SELECT id FROM kw)
        SELECT c.id, c."documentId", c."sourceId", c."content", c."sectionTitle", c."pageNumber",
               s."title", s."sourceType"::text AS "sourceType", s."categories"::text[] AS "categories",
               s."city", s."updatedAt",
               (1 - (c."embedding" <=> q.v))::float8 AS "semantic",
               -- Keyword signal: the share of the query's terms the passage contains.
               CASE WHEN cardinality(q.terms) = 0 THEN 0 ELSE (
                 SELECT count(*) FROM unnest(q.terms) t
                 WHERE to_tsvector('english', c."content") @@ plainto_tsquery('simple', t)
               )::float8 / cardinality(q.terms) END AS "keyword",
               c."embedding"::text AS "embedding"
        FROM ids
        JOIN knowledge_chunks c ON c.id = ids.id
        JOIN knowledge_sources s ON s.id = c."sourceId", q
        WHERE ${predicate}
      `);
    });

    const candidates: Candidate[] = rows.map((row) => ({
      chunkId: row.id,
      documentId: row.documentId,
      sourceId: row.sourceId,
      content: row.content,
      sectionTitle: row.sectionTitle,
      pageNumber: row.pageNumber,
      title: row.title,
      sourceType: row.sourceType,
      categories: row.categories ?? [],
      city: row.city,
      updatedAt: row.updatedAt,
      semantic: Number(row.semantic),
      keyword: Number(row.keyword),
      embedding: parseVectorLiteral(row.embedding),
    }));

    // The threshold gates on relevance itself — semantic similarity, or
    // matching at least half the query's terms — never on source, context or
    // recency, which could otherwise carry an unrelated chunk over the line.
    const scored = score(candidates, request.context, settings.weights).filter(
      (c) =>
        c.signals.semantic >= settings.similarityThreshold ||
        c.signals.keyword >= KEYWORD_COVERAGE_GATE,
    );
    const k = request.topK ?? settings.topK;
    const passages = (
      settings.rerankEnabled
        ? diversify(scored, k, settings.rerankTopK)
        : scored.slice(0, k)
    ).map(({ embedding: _embedding, ...rest }) => rest as Scored);
    const best = Math.max(0, ...candidates.map((c) => c.semantic));
    const ms = Date.now() - started;

    // Counts, scores and timings — never query or document text.
    this.logger.log(
      `retrieval ${RETRIEVAL_VERSION}: ${candidates.length} candidates, ${passages.length} returned, ` +
        `best semantic ${best.toFixed(3)}, top score ${(passages[0]?.score ?? 0).toFixed(3)}, ${ms} ms` +
        (query.cached ? ' (query embedding cached)' : ''),
    );
    return {
      passages,
      candidates: candidates.length,
      weak: best < settings.weakSemantic,
      embeddingModel: query.model,
      embeddingVersion: query.version,
      retrievalVersion: RETRIEVAL_VERSION,
      ms,
    };
  }

  /**
   * The query's embedding. Cached in Redis by a hash of the text — vectors
   * are derived from the text alone and carry nothing about who asked, so a
   * shared cache cannot leak across users. Results are never cached.
   */
  private async embedQuery(
    text: string,
  ): Promise<{ vector: number[]; model: string; version: string; cached: boolean }> {
    const ttl = this.config.rag.queryCacheSeconds;
    const key = `rag:qemb:v1:${createHash('sha256').update(text).digest('hex')}`;
    if (ttl > 0) {
      const hit = await this.redis.connection.get(key).catch(() => null);
      if (hit) {
        try {
          const value = JSON.parse(hit) as {
            vector: number[];
            model: string;
            version: string;
          };
          if (
            Array.isArray(value.vector) &&
            value.vector.length === EMBEDDING_DIMENSIONS
          ) {
            return { ...value, cached: true };
          }
        } catch {
          // fall through to a fresh embedding
        }
      }
    }
    const outcome = await this.ai.embedText([text]);
    if (!outcome.ok || !outcome.embeddings.vectors[0]) {
      throw new RetrievalUnavailableError(
        outcome.ok ? 'No embedding returned' : outcome.failure.message,
      );
    }
    const value = {
      vector: outcome.embeddings.vectors[0],
      model: outcome.embeddings.modelName,
      version: outcome.embeddings.modelVersion,
    };
    if (ttl > 0)
      await this.redis.connection
        .set(key, JSON.stringify(value), 'EX', ttl)
        .catch(() => undefined);
    return { ...value, cached: false };
  }
}
