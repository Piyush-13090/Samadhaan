-- Prompt 27: stored full-text vector for problem search.
--
-- Measured on the 100k-problem benchmark dataset: ranking a broad keyword
-- query ("pothole road", 80k matches) took ~1,000 ms because ts_rank_cd had to
-- re-run to_tsvector on every matching row; the GIN expression index only
-- helps the @@ filter. Storing the vector (computed once per write) took the
-- same query to ~83 ms. See docs/PERFORMANCE_AUDIT.md.
--
-- Hand-written: Prisma cannot express generated columns. The expression is the
-- one the former "problems_search_fts" index used, so ranking is unchanged.
-- Adding a STORED column rewrites the table under an ACCESS EXCLUSIVE lock —
-- run in a maintenance window on a large production table.

ALTER TABLE "problems" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("subcategory", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
  setweight(to_tsvector('simple', coalesce("address", '') || ' ' || coalesce("city", '') || ' ' ||
    coalesce("state", '') || ' ' || coalesce("postalCode", '')), 'C')
) STORED;

-- CreateIndex
CREATE INDEX "problems_search_vector_gin" ON "problems" USING GIN ("searchVector");

-- The expression index is superseded; keeping it would only cost writes.
DROP INDEX IF EXISTS "problems_search_fts";
