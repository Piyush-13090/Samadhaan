# Performance Audit (Prompt 27)

Measure first, optimise second, verify every change. Every finding below is
backed by a measurement taken on the benchmark environment described in
[PERFORMANCE_BENCHMARKS.md](./PERFORMANCE_BENCHMARKS.md); nothing here is a
production capacity claim. Numbers are p50 / p95 / p99 in milliseconds at 10
concurrent virtual users unless stated.

## Summary

| # | Component | Status | Before → after (p50 / p95) |
| - | --- | --- | --- |
| P1 | Problem keyword search ranking | **Fixed** (stored `searchVector`) | caches off: 568 / 3,465 → 161–180 / 420–479 |
| P2 | Government jurisdiction filter (`lower(city)`) | **Fixed** (expression index) | dashboard 492 / 653 → 208 / 271; queue 193 / 306 → 109 / 142 |
| P3 | Knowledge keyword branch | **Fixed** (stored `contentVector`) | keyword branch 154 → 47 ms inside the query |
| P4 | Knowledge embeddings pushed to TOAST | **Fixed** (`SET STORAGE MAIN`) | exact top-40 scan 42 → 20 ms; TOAST 31 → 4 MB |
| P5 | AI service PDF chunking blocked the event loop | **Fixed** (worker thread, capacity 2) | `/health` max during a 400-page PDF: 941 → 119–168 ms |
| P6 | HNSW index larger than `shared_buffers` | **Documented** (sizing) | cold semantic query 1,268 ms, 7,124 pages read |
| P7 | Connection pool not configurable; unbounded wait | **Fixed** (env-configurable, 10 s acquire timeout) | pool 20 vs 10: unified p95 ~345 vs ~400–440 |
| P8 | Request logs carried query strings | **Fixed** (path only) | privacy / cardinality, not latency |
| P9 | Fresh-database migration failed (`DROP INDEX` HNSW) | **Fixed** (`IF EXISTS`) | correctness of new installs |
| — | Knowledge search throughput (~26 rps) | Remaining, within target | 371 / 487 (target < 800) |

## Findings

Each finding records the component, observed behaviour, measurement,
bottleneck, fix, risk and before/after.

### P1 — Problem keyword search recomputed `to_tsvector` per row

- **Component:** `ProblemSearchService.rankCandidates`, `coverage()`,
  suggestions and project search (`src/search/search-sql.ts` `PROBLEM_TSV`).
- **Observed:** `/search/problems` with caches off: p50 568, p95 3,465,
  p99 3,626 ms; 8.5 rps.
- **Measurement:** `auto_explain` (`log_analyze`, `buffers`) on the benchmark DB.
  "pothole road" matches 80k of 100k problems; the bitmap index scan took
  7.5 ms but the query 1,515 ms, because `ts_rank_cd(<expression>, …)` re-ran
  four `to_tsvector` calls on every matching row. The GIN *expression* index
  only serves the `@@` filter.
- **Fix:** stored generated column `problems."searchVector"` with the identical
  weighted expression, GIN index `problems_search_vector_gin`; `PROBLEM_TSV`
  now reads the column. Migration `20261017090000_search_vector`; the old
  expression index is dropped. Declared in Prisma as
  `Unsupported("tsvector")? @default(dbgenerated())` so `migrate dev` does not
  propose dropping it (verified with `prisma migrate diff`: no new drift).
- **Risk:** ranking is unchanged (same expression, same weights). Adding a
  STORED column rewrites the table under `ACCESS EXCLUSIVE` — about 8 s for
  100k rows here; schedule a maintenance window on large production tables.
  The heap grows by the stored vector (~290 bytes/row on the synthetic data:
  41 → 71 MB at 100k rows); the new GIN index is 6 MB (the expression index it
  replaces was 9.6 MB). Writes compute the vector once.
- **Before → after:** isolated query 1,005 → 83 ms ("pothole road"), 210 → 30
  ms ("blocked drain"). Endpoint, caches off: 568 / 3,465 / 3,626 →
  161 / 420 / 658 (and 180 / 479 / 540 on a repeat run).

### P2 — Jurisdiction predicate scanned the whole problems table

- **Component:** `src/government/jurisdiction.ts` (`lower(p."city") = ANY(…)`),
  used by the government dashboard, review queue, analytics and maps.
- **Observed:** gov-dashboard p50 492, p95 653 ms; review queue p50 193.
- **Measurement:** dashboard totals query: `Seq Scan on problems`, 95,000 rows
  removed by filter, 107 ms per call (62 ms in isolation).
- **Fix:** expression index `problems_city_lower` on `lower("city")`, in
  `prisma/sql/post-migrate.sql` (Prisma cannot express expression indexes).
  Also serves the `city` filters in search, analytics and impact.
- **Risk:** one extra B-tree on `problems` (write cost small). Row estimates
  also improved (500 → 5,033 estimated vs 5,000 actual).
- **Before → after:** isolated 62 → 3.2 ms. gov-dashboard 492 / 653 / 788 →
  208 / 271 / 306; review queue 193 / 306 / 380 → 109 / 142 / 171 (caches on).

### P3 — Knowledge keyword branch recomputed `to_tsvector` per chunk

- **Component:** `KnowledgeRetrievalService` hybrid query (`kw` CTE and the
  keyword-coverage signal), `KnowledgeSearchService.keywordOnly`.
- **Measurement:** the keyword branch took 154 ms of a 170 ms retrieval query on
  20k chunks (all synthetic chunks match the test queries — a worst case).
- **Fix:** stored generated column `knowledge_chunks."contentVector"` and GIN
  index `knowledge_chunks_content_vector_gin` (migration
  `20261017091000_knowledge_content_vector`); expression index dropped.
- **Risk:** identical configuration (`english`); retrieval results unchanged.
- **Before → after:** keyword branch 154 → 47 ms inside the query under load.

### P4 — Knowledge embeddings stored out of line (TOAST)

- **Component:** `knowledge_chunks.embedding` (pgvector `vector(384)`).
- **Observed:** after P3 the vector branch read ~61k buffers per query.
- **Measurement:** pgvector's type defaults to `EXTERNAL` storage; rows over the
  ~2 KB TOAST threshold (1.5 KB vector + content + tsvector) moved the vector
  out of line: heap 11 MB, TOAST 31 MB. Every distance computation then paid a
  TOAST fetch.
- **Fix:** `ALTER COLUMN "embedding" SET STORAGE MAIN` in the same migration,
  before the column add, so the single table rewrite applies it. `content`
  is moved out first; the vector only as a last resort.
- **Before → after:** exact top-40 scan over 20k chunks (warm) 42 → 20 ms;
  heap 39 MB / TOAST 4 MB. `problem_embeddings` rows are narrow and have no
  TOAST data, so they were left unchanged.

### P5 — AI service: PDF extraction blocked the event loop

- **Component:** `services/ai/app/api/routes/knowledge.py` `/chunk`.
- **Measurement:** `scripts/perf/ai-blocking-probe.py` polls `/health` while a
  400-page PDF is chunked (~0.9–1.0 s of CPU): `/health` max latency 941 ms
  (p50 471). Plain text (990 KB) chunked in 0.09 s — not a bottleneck.
- **Fix:** `anyio.to_thread.run_sync(chunk_document, …,
  limiter=CapacityLimiter(2))`. Embedding encode was already off-loop.
- **Before → after:** `/health` max 941 → 119–168 ms over three runs (p50
  ~95–102; the residue is the GIL).

### P6 — HNSW index does not fit in `shared_buffers` (sizing, not code)

- **Measurement:** `problem_embeddings_vector_hnsw` is 195 MB for 100k vectors
  (~2 KB/vector); the benchmark server has `shared_buffers = 128MB`. A cold
  semantic query read 7,124 index pages and took 1,268 ms; warm repeats
  155–460 ms with the app's `ef_search = 100` + iterative scan, LIMIT 200.
  In isolation (warm, LIMIT 50) HNSW answers in 3–10 ms vs 64 ms exact.
- **Recall:** on the synthetic **random** vectors, recall@50 was 0.15–0.26 for
  `ef_search` 40–200. Random high-dimensional noise is the worst case for ANN
  and says nothing about real sentence embeddings, which cluster; the app's
  settings were not changed on the basis of synthetic data. See
  [PERFORMANCE_BENCHMARKS.md](./PERFORMANCE_BENCHMARKS.md#vector-search).
- **Action:** size `shared_buffers` (and RAM) so hot HNSW indexes stay resident
  — see [SCALABILITY_GUIDE.md](./SCALABILITY_GUIDE.md). Quantisation
  (`halfvec`) would halve the index but needs a recall benchmark on real
  embeddings first; not done.
- **Residual effect:** unified search caches-off p99 ~1.7 s on a warm run.

### P7 — Connection pool

- **Observed:** `PrismaPg({ connectionString })` used node-postgres defaults:
  10 connections and an **unbounded** wait for a free one.
- **Measurement:** unified search (four parallel sub-searches per request, two
  of them in transactions for `SET LOCAL`) at c=10: pool 10 → p95 400–438,
  p99 543–1,972; pool 20 → p95 338–353, p99 395–415.
- **Fix:** `DATABASE_POOL_MAX` (default 10, unchanged),
  `DATABASE_POOL_ACQUIRE_TIMEOUT_MS` (default 10 s: a saturated pool now fails
  a request instead of hanging it) and `DATABASE_STATEMENT_TIMEOUT_MS`
  (default off; recommended in production).
- **Risk:** the acquire timeout surfaces as a 500 under extreme saturation
  rather than an indefinite hang. Pool × replicas must stay below
  `max_connections`.

### P8 — Request logs

- pino-http logged `req.url` with the query string, so search text and filters
  typed by users reached the logs, and `url` was unbounded-cardinality for
  aggregation. The request serializer now logs `id`, `method` and the path
  only; `responseTime` (ms) remains on each completion line as the per-request
  latency metric. Unit-tested in `security.spec.ts`.

### P9 — Fresh-install migration

- `20261008090000_government_portal` dropped the HNSW index unconditionally,
  but on a fresh database that index is only created by `post-migrate.sql`
  after all migrations — `migrate deploy` failed (P3009). Now
  `DROP INDEX IF EXISTS`. Found while building the benchmark database.

## Reviewed and found adequate (no change)

| Area | Finding |
| --- | --- |
| Transactions | No `$transaction` body calls the AI service, embeddings, geocoding or HTTP (scanned all interactive transactions). |
| Payload bounds | Every list DTO caps `limit` (`@Max`: 8–100 depending on endpoint). |
| Query-embedding cache | `KnowledgeRetrievalService.embedQuery` already caches query vectors in Redis by SHA-256 of the text. |
| Analytics | Cached p95 ~15 ms; uncached p95 49–52 ms (after P2) — inside the 500 ms target with caches off. |
| Suggestions | p95 4–5 ms (target 200). |
| Notifications / leaderboard | p95 4–5 ms. |
| Nearby / PostGIS | p95 19–22 ms (GiST `problems_location_gist`). |
| Frontend | `maplibre-gl` (the only heavy dependency) is already behind `next/dynamic`; charts are hand-rolled SVG. No change. |
| Rate limits | 429s in the load tests are the per-user limits working (search 30/min, leaderboard 120/min) when 600 users issue thousands of requests per second; they are not errors. |

## Remaining bottlenecks and trade-offs

1. **Knowledge search throughput** (~26 rps here, p50 ~375 ms at c=10, 69 ms at
   c=1). At 20k chunks the planner correctly prefers an exact vector scan
   (100% recall) to HNSW under the access predicate; the cost is CPU per
   request. Within the 800 ms search target. Re-measure as the corpus grows;
   HNSW takes over once the exact plan costs more.
2. **HNSW memory** (P6): the semantic channel's tail latency depends on the
   index being resident.
3. **Problem listing p95 ~335–375 ms** (`/problems/nearby` without a point):
   inside the 500 ms listing target; not investigated further.
4. **Citizen dashboard p50 ~150 ms**: inside target; not investigated further.
5. **Postal-code jurisdictions** use `upper(p."postalCode") = ANY(…)` with no
   expression index. No benchmark office uses postal codes, so it was not
   measured; add `problems ((upper("postalCode")))` when one does.
