-- ===========================================================================
-- Database objects Prisma's schema language cannot express.
--
-- Idempotent and safe to run repeatedly. Applied automatically by
-- `npm run db:migrate` and `npm run db:deploy` after the migrations, because
-- `prisma migrate dev` regenerates its diff from schema.prisma alone and will
-- otherwise propose DROPping anything it does not know about.
--
-- Keep this file minimal. Anything Prisma *can* express belongs in
-- schema.prisma, where it is version-controlled with the models — the GiST and
-- trigram indexes were moved there for exactly that reason.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- pgvector HNSW index for approximate nearest-neighbour search.
--
-- Prisma has no syntax for HNSW, so declaring it here is the only way to keep
-- it. `IF NOT EXISTS` makes re-running free.
--
-- HNSW rather than IVFFlat: IVFFlat needs a training pass over existing rows
-- and degrades until it is rebuilt, which does not suit a corpus growing
-- continuously from empty. `vector_cosine_ops` matches the normalised vectors
-- the embedding models produce.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "problem_embeddings_vector_hnsw"
  ON "problem_embeddings" USING hnsw ("embedding" vector_cosine_ops);

-- Organisation profiles (Prompt 14). Same index, same reasons.
CREATE INDEX IF NOT EXISTS "organization_embeddings_vector_hnsw"
  ON "organization_embeddings" USING hnsw ("embedding" vector_cosine_ops);

-- One active allocation per problem (Prompt 16). Partial: Prisma cannot
-- express it, and would otherwise drop it on the next `migrate dev`.
CREATE UNIQUE INDEX IF NOT EXISTS "problem_allocations_one_active"
  ON "problem_allocations" ("problemId")
  WHERE "status" IN ('PENDING', 'ACCEPTED');

-- Prompt 19: one OPEN coordinator question per fingerprint (partial index,
-- which Prisma cannot express).
CREATE UNIQUE INDEX IF NOT EXISTS "coordinator_questions_one_open"
  ON "coordinator_questions" ("projectId", "fingerprint")
  WHERE "status" = 'OPEN';

-- Prompt 20: knowledge retrieval indexes (Prisma cannot express them).
CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_hnsw"
  ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
-- (Full-text: a stored generated column with a GIN index since Prompt 27 —
-- migration 20261017091000_knowledge_content_vector.)

-- At most one pending resolution verification request per project (Prompt 22).
CREATE UNIQUE INDEX IF NOT EXISTS "resolution_verification_requests_one_pending"
  ON "resolution_verification_requests" ("projectId") WHERE "status" = 'PENDING';

-- ---------------------------------------------------------------------------
-- Prompt 25: full-text search indexes (expression GIN indexes, which Prisma
-- cannot express). The search queries use exactly these expressions — see
-- apps/api/src/search/search-sql.ts — so the planner can use the indexes.
-- Weights: A = title/subcategory/name, B = description, C = place.
-- ---------------------------------------------------------------------------
-- Problems: a stored generated column with a plain GIN index since Prompt 27
-- (migration 20261017090000_search_vector), not an expression index here.
CREATE INDEX IF NOT EXISTS "problem_ai_analyses_summary_fts" ON "problem_ai_analyses"
  USING gin (to_tsvector('english', coalesce("summary", '')));
CREATE INDEX IF NOT EXISTS "organizations_search_fts" ON "organizations" USING gin ((
  setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
  setweight(to_tsvector('simple', coalesce("city", '') || ' ' || coalesce("state", '')), 'C')
));
CREATE INDEX IF NOT EXISTS "resolution_projects_search_fts" ON "resolution_projects"
  USING gin (to_tsvector('english', coalesce("name", '') || ' ' || coalesce("description", '')));
CREATE INDEX IF NOT EXISTS "knowledge_sources_title_fts" ON "knowledge_sources"
  USING gin (to_tsvector('english', coalesce("title", '')));

-- ---------------------------------------------------------------------------
-- Prompt 27: government jurisdiction filter. Offices scoped by city match
-- `lower(p."city") = ANY(...)` (src/government/jurisdiction.ts) on every
-- dashboard, queue and analytics query; without this expression index each
-- one scanned the whole problems table (62 ms -> 3 ms for one city of 100k
-- problems on the benchmark dataset — docs/PERFORMANCE_AUDIT.md). The same
-- expression serves the `city` filters in search, analytics and impact.
-- Expression index: Prisma cannot express it.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "problems_city_lower" ON "problems" (lower("city"));
