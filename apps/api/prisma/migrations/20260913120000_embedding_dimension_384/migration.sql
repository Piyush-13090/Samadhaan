-- Narrow the embedding column to the native width of the configured encoder.
--
-- `sentence-transformers/all-MiniLM-L6-v2` produces 384-dimensional vectors.
-- The column was declared 1536 in anticipation of an OpenAI-class encoder that
-- this project does not use; padding a 384-vector into it would waste index
-- space and make a genuine dimension mismatch look correct.
--
-- Safe as written: `problem_embeddings` has never been populated — duplicate
-- detection is the first milestone to write it. If it ever holds rows, the
-- vectors are not convertible and must be regenerated, which is why this drops
-- them rather than attempting a cast.

-- The HNSW index is bound to the column type and must go first.
DROP INDEX IF EXISTS "problem_embeddings_vector_hnsw";

DELETE FROM "problem_embeddings";

ALTER TABLE "problem_embeddings"
  ALTER COLUMN "embedding" TYPE vector(384),
  ALTER COLUMN "dimensions" SET DEFAULT 384;

-- Recreated by prisma/sql/post-migrate.sql, which runs after every migration.
