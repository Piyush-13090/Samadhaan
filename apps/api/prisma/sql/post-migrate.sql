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
