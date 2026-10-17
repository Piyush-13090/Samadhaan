-- Prompt 27: stored full-text vector for knowledge retrieval.
--
-- Same finding as problems.searchVector (20261017090000_search_vector): the
-- keyword branch of hybrid retrieval ranked matches with
-- ts_rank_cd(to_tsvector('english', content), ...), re-parsing every matching
-- chunk — 154 ms of a 170 ms retrieval query on the 20k-chunk benchmark
-- corpus. A stored vector is computed once, when the chunk is written.
--
-- Hand-written: Prisma cannot express generated columns. Same configuration
-- ('english') as the expression index it replaces, so matching and ranking
-- are unchanged. Rewrites the table (ACCESS EXCLUSIVE) — maintenance window
-- on a large production corpus.

-- Keep embeddings in the main row. pgvector's type defaults to EXTERNAL
-- storage, so once a row passes the ~2 KB TOAST threshold (a 384-d vector is
-- 1.5 KB; the stored tsvector below adds ~180 bytes) the embedding is the first
-- value moved out of line, and every vector comparison then pays a TOAST
-- fetch. Measured on 20k chunks: exact top-40 scan 42 ms -> 20 ms, TOAST
-- 31 MB -> 4 MB. MAIN moves `content` out first and the vector only as a last
-- resort. Set before the column is added so the one rewrite applies it.
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" SET STORAGE MAIN;

ALTER TABLE "knowledge_chunks" ADD COLUMN "contentVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

-- CreateIndex
CREATE INDEX "knowledge_chunks_content_vector_gin" ON "knowledge_chunks" USING GIN ("contentVector");

-- Superseded expression index (created by post-migrate.sql until Prompt 27).
DROP INDEX IF EXISTS "knowledge_chunks_content_fts";
