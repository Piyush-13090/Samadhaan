# Performance Benchmarks (Prompt 27)

How Samadhaan is load-tested, on what, and what was measured. These are
**local, single-machine** measurements for finding bottlenecks and verifying
fixes. They are not production capacity numbers: the load generator,
PostgreSQL, Redis, the API and the AI service all shared one laptop's CPU.

## Rules

- Never against production or the shared development database. The tooling
  refuses any database whose name does not end in `_perf`.
- Synthetic data only (deterministic seed); no real user data.
- A dedicated Redis logical database (`/5`) — the load test clears
  `ratelimit:*` keys there between scenarios, which must never happen on a
  shared Redis.
- Timing assertions do not belong in unit tests; regressions are guarded
  structurally (see [Regression tests](#regression-tests)).

## Environment

| Item | Value |
| --- | --- |
| Machine | Apple M-series, 8 cores, 8 GB RAM, macOS 26.4 |
| PostgreSQL | 17.11 (Homebrew), `shared_buffers = 128MB`, `max_connections = 100`, PostGIS, pgvector |
| API | compiled build (`node dist/main.js`), port 4100, `LOG_LEVEL=warn`, background sweeps off, pool 10 unless stated |
| AI service | port 8101, `LLM_PROVIDER=development`, real `all-MiniLM-L6-v2` embeddings |
| Load generator | `apps/api/scripts/perf/load-test.mjs`, same machine |

## Dataset (`scripts/perf/seed-perf.sql`)

20 cities; 20,000 users (40 government officials — two per office across 20
offices — 800 NGO members across 400 NGOs, the rest citizens); 100,000
problems; 300k votes; follows; 130k status-change audit rows; ~40k AI analyses;
200k notifications; 70k impact-ledger rows plus `user_impact_stats`; 100k
**random** 384-d problem embeddings; 200 knowledge sources / 20k chunks.
Database ≈ 850 MB. Seeding takes ~5 minutes (HNSW indexes are dropped before
the bulk load and rebuilt — 4 min 7 s for 100k vectors).

## Running

```bash
cd apps/api
export PERF_DATABASE_URL=postgresql://…/samadhaan_perf   # must end in _perf
export PERF_PASSWORD_HASH='<bcrypt hash of the perf password>'
scripts/perf/reset-perf-db.sh            # drop, create, migrate, post-migrate, seed
npm run build
scripts/perf/restart-perf-api.sh         # port 4100; add ANALYTICS_CACHE_SECONDS=0 SEARCH_CACHE_SECONDS=0 for uncached runs
PERF_REDIS_URL=redis://localhost:6379/5 \
  node scripts/perf/load-test.mjs --users=600 --concurrency=10 --duration=20 \
  --out=scripts/perf/results/run.json
```

The load test signs in `--users` distinct citizen accounts (and two officials
of `perf-office-0`), each from its own `X-Forwarded-For` address, and rotates
sessions per request so per-user and per-IP rate limits behave as they would
for that many people. Each scenario gets one untimed warm-up request.

Query plans were captured with `auto_explain` enabled **only on the perf
database** (`ALTER DATABASE samadhaan_perf SET session_preload_libraries =
'auto_explain'`, `log_min_duration` 50–250 ms, `log_analyze`, `log_buffers`)
and reset before every timed run.

## Results (c = 10, 20 s per scenario)

p50 / p95 / p99 in ms; rps = completed requests per second. Raw JSON in
`apps/api/scripts/perf/results/`.

### Caches on (production configuration)

| Scenario | Target | Before | After | rps before → after |
| --- | --- | --- | --- | --- |
| citizen-dashboard | < 300 | 143 / 170 / 199 | 152 / 174 / 190 | 74 → 68 |
| problem-listing | < 500 | 110 / 360 / 433 | 103 / 375 / 431 | 69 → 67 |
| nearby-search | < 500 | 8 / 22 / 40 | 7 / 19 / 32 | 962 → 1,115 |
| search-suggest | < 200 | 3.1 / 4.5 / 5.6 | 3.0 / 4.3 / 5.1 | 2,960 → 3,173 |
| search-problems (cached) | < 800 | 7 / 13 / 26 | 3 / 9 / 10 | rate-limited ¹ |
| search-unified | < 800 | 68 / 539 / 664 | 53 / 370 / 524 | 50 → 67 |
| gov-review-queue | < 500 | 193 / 306 / 380 | 109 / 142 / 171 | 50 → 91 |
| gov-dashboard | < 500 | 492 / 653 / 788 | 208 / 271 / 306 | 20 → 48 |
| analytics-overview | < 500 | 7 / 16 / 23 | 7 / 16 / 28 | ~1,100 |
| analytics-resolution | < 500 | 7 / 15 / 18 | 7 / 14 / 16 | ~1,300 |
| knowledge-search | < 800 | 430 / 528 / 569 | 371 / 487 / 521 | 23 → 26 |
| notifications | < 300 | 2.8 / 4.4 / 5.4 | 3.0 / 5.0 / 7.0 | ~3,200 |
| leaderboard | < 300 | 2.2 / 3.2 / 5.0 | 2.3 / 4.0 / 6.3 | rate-limited ¹ |

¹ Cached responses are fast enough that 600 users exceed their per-user
limits (search 30/min, leaderboard 120/min): 429s are the limiter working, and
latency covers both 200s and 429s. Error rate otherwise 0%.

### Caches off (worst case: every request hits PostgreSQL)

| Scenario | Before | After |
| --- | --- | --- |
| search-problems-keyword | 568 / 3,465 / 3,626 (8.5 rps) | 161 / 420 / 658 (46.5 rps); repeat 180 / 479 / 540 |
| search-unified | 437 / 904 / 985 | warm repeat 219 / 489 / 1,697; cold first run after `VACUUM FULL` 195 / 3,516 / 4,461 ² |
| analytics-overview | 45 / 65 / 86 | 16 / 49 / 65 |
| analytics-resolution | 49 / 70 / 89 | 21 / 52 / 81 |
| knowledge-search | 439 / 528 / 558 | 391 / 480 / 616; repeat 375 / 413 / 485 |
| gov-dashboard | — | 224 / 355 / 563; repeat 229 / 346 / 404 |

² The semantic channel reads the 195 MB HNSW index, which does not fit in
128 MB `shared_buffers`; a cold run pays page reads (audit P6).

### Connection pool (caches off, two runs each)

| Pool | search-unified p95 / p99 | search-problems p95 / p99 |
| --- | --- | --- |
| 10 (default) | 438 / 1,972; 400 / 544 | 558 / 907; 393 / 502 |
| 20 | 353 / 415; 338 / 395 | 334 / 425; 326 / 361 |

## Query-level measurements

| Query | Before | After |
| --- | --- | --- |
| Problem keyword candidates, "pothole road" (80k matches) | 1,005 ms | 83 ms |
| Problem keyword candidates, "blocked drain" (10k matches) | 210 ms | 30 ms |
| Dashboard totals, one city (5k of 100k problems) | 62 ms (seq scan) | 3.2 ms (bitmap on `problems_city_lower`) |
| Knowledge hybrid retrieval, keyword branch | 154 ms | 47 ms |
| Exact top-40 over 20k knowledge vectors (warm) | 42 ms (TOAST) | 20 ms (inline) |

## Vector search

20 query vectors drawn from the corpus, exact top-50 as ground truth (seq scan,
one psql session), warm cache, 100k random 384-d vectors:

| Mode | Avg latency | Recall@50 |
| --- | --- | --- |
| HNSW `ef_search=40` | 3.3 ms | 0.147 |
| HNSW `ef_search=100` (app setting) | 5.1 ms | 0.182 |
| HNSW `ef_search=200` | 10.2 ms | 0.262 |
| HNSW `ef_search=100`, `iterative_scan=relaxed_order` | 4.1 ms | 0.182 |
| Exact (sequential scan) | 64.3 ms | 1.000 |

The recall figures are **not** representative: uniformly random vectors have no
neighbourhood structure, the worst case for any ANN graph. Real sentence
embeddings cluster and HNSW recall on them is typically far higher. The
latency figures are valid. Before changing `ef_search` or index parameters,
benchmark recall on real embeddings from the same model — never mix models
in one index.

## AI service event-loop probe

`scripts/perf/ai-blocking-probe.py pdf` — `/health` latency while a 400-page
PDF is chunked: before max 941 ms (p50 471); after three runs max 119 / 131 /
168 ms (p50 ~95–102). `text` mode (990 KB) chunks in 0.09 s.

## Frontend bundle (production build)

| Item | Raw | gzip |
| --- | --- | --- |
| Shared first-load JS (`rootMainFiles`, 5 chunks) | 442 KB | 132 KB |
| `maplibre-gl` chunk | 1,042 KB | 282 KB |

The map chunk appears only in route `react-loadable-manifest.json` files (problem
detail, government map/analytics/review, organisation settings): it is
loaded on demand through `next/dynamic`, never on first load. No other heavy
dependency exists (charts are hand-rolled SVG), so no bundle change was made.

## Regression tests

Structural, not timing-based, so they are stable on any CI machine:

- `apps/api/test/performance.e2e-spec.ts` — `EXPLAIN` shows
  `problems_city_lower` for the jurisdiction predicate, and
  `problems_search_vector_gin` / `knowledge_chunks_content_vector_gin` for
  full-text, with no per-row `to_tsvector` in the problem ranking plan; the
  generated `searchVector` tracks title/description updates; knowledge
  embeddings use `MAIN` storage.
- `apps/api/test/search.e2e-spec.ts` — full-text index usage (updated to the
  new index) and bounds on pathological queries.
- `apps/api/src/config/app.config.spec.ts` — pool configuration defaults and
  validation.
- Every list DTO's `limit` has a `@Max` (payload bound).
