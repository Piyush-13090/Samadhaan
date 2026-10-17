# Scalability Guide (Prompt 27)

How to scale Samadhaan as load grows, in the order the measurements suggest,
and the thresholds that would justify bigger architectural steps. Grounded in
[PERFORMANCE_AUDIT.md](./PERFORMANCE_AUDIT.md) and
[PERFORMANCE_BENCHMARKS.md](./PERFORMANCE_BENCHMARKS.md); those numbers come
from one laptop and are not production capacity figures. Re-measure on
production-like hardware before sizing.

## Current shape

- **API** (NestJS): stateless. Sessions, rate limits and caches live in Redis
  and PostgreSQL, so replicas can be added behind a load balancer
  (`trust proxy` is set for one hop).
- **PostgreSQL**: the system of record, full-text search, PostGIS and pgvector.
  At the benchmark volume (100k problems, 20k knowledge chunks, 850 MB) every
  scenario met its target with the fixes in the audit.
- **Redis**: caches, rate limits, locks.
- **AI service** (FastAPI): CPU-bound embeddings and extraction; LLM calls go
  to an external provider.

## Scaling levers, in order

1. **Size PostgreSQL memory for the hot indexes.** The problem HNSW index is
   ~2 KB per vector (195 MB at 100k). With `shared_buffers` below that, a cold
   semantic query read 7,124 pages and took 1.27 s. Rule of thumb: keep
   `shared_buffers` (≈25% of RAM) above the sum of HNSW indexes plus the hot
   heap, and RAM above that again for the OS cache. Watch the buffer hit ratio
   (`pg_stat_database.blks_hit / (blks_hit + blks_read)`); below ~99% on the
   search path, add memory before anything else.
2. **Connection pool.** `DATABASE_POOL_MAX` per API process (default 10).
   Unified search fans out four queries per request; pool 20 cut its p95 from
   ~400–440 ms to ~345 ms at 10 concurrent users. Keep
   `replicas × DATABASE_POOL_MAX + headroom (migrations, jobs, psql) <
   max_connections`. Past ~200 total connections, put PgBouncer (transaction
   mode) in front rather than raising `max_connections`. Note that
   transaction-mode pooling still honours `SET LOCAL` inside transactions, which is
   how the HNSW settings are applied.
3. **Statement and acquire timeouts.** Set `DATABASE_STATEMENT_TIMEOUT_MS`
   (e.g. 30,000) in production as a backstop; keep
   `DATABASE_POOL_ACQUIRE_TIMEOUT_MS` so a saturated pool fails fast instead
   of hanging requests.
4. **More API replicas.** The API is stateless; add replicas when Node CPU
   (not PostgreSQL) is the limit. In the benchmarks Node sat at ~18% CPU while
   PostgreSQL did the work, so replicas alone would not have helped.
5. **Separate the AI service.** Embedding and PDF extraction are CPU-bound and
   share cores with everything else on a single host. Run it on its own
   host(s) and scale horizontally; it is stateless. PDF extraction runs in a
   worker thread with capacity 2 per process, so `/health` and embeddings stay
   responsive.
6. **Read replica** for analytics and dashboards once the primary's CPU is
   dominated by read aggregations. Analytics already tolerates 2 minutes of
   staleness (cache TTL), so replica lag of seconds is acceptable there.
   Writes and anything read-after-write (problem detail after submission)
   stay on the primary.
7. **Partitioning** `audit_logs`, `notifications` and `impact_transactions` by
   time once they reach tens of millions of rows and retention jobs or
   time-range scans slow down. Not needed at the benchmark volume.

## Thresholds for architectural changes

| Change | Justified when | Not justified by |
| --- | --- | --- |
| Elasticsearch / OpenSearch | Full-text p95 over target **after** stored vectors and GIN (done), with corpus in the tens of millions of documents, or a need for features PostgreSQL FTS lacks (fuzzy multilingual analysers at scale). | Current data: keyword search p95 ~420–480 ms uncached, ~9 ms cached at 100k problems. |
| Dedicated vector DB | pgvector HNSW cannot stay memory-resident on the largest practical instance, or filtered ANN recall on real embeddings falls below what `ef_search`/iterative scans can recover. | Synthetic-random recall (not representative). |
| Kafka / event bus | Several independent consumers need the same event stream with replay, or job throughput exceeds what PostgreSQL-backed sweeps and Redis locks sustain. | Current background jobs (priority, matching, verification, RAG, impact reconcile) are sweep-based and idempotent. |
| Kubernetes | Many services with independent scaling and rollout needs, operated by a team that already runs it. | Three stateless services plus PostgreSQL and Redis; a managed container platform or VMs suffice. |
| Multi-region | Legal/data-residency requirements or measured cross-region latency for users. | Not in scope (Prompt 27). |

## Graceful degradation (existing behaviour, verified in earlier prompts)

- Redis down → caches miss and rate limiting fails open
  (`rate-limit.guard.ts`, `user-rate-limit.guard.ts`); requests continue.
- AI service down → problem search drops the semantic channel and serves
  keyword results; `/health` reports `aiService` as degraded.
- LLM provider errors → retried (`max_retries=2`) then surfaced as unavailable;
  no fabricated output.
- Pool saturated → requests fail after `DATABASE_POOL_ACQUIRE_TIMEOUT_MS`
  rather than hanging.

## Operational checklist when scaling

- Re-run `scripts/perf/load-test.mjs` against a `_perf` copy on the new
  hardware; compare against `scripts/perf/results/`.
- Capture plans with `auto_explain` on the perf database only.
- Watch: p95 per route (`responseTime` in the request logs, path only),
  PostgreSQL buffer hit ratio, active connections vs pool, Redis memory,
  AI service CPU.
- Never add an index without a query plan showing it is used; the
  `performance.e2e-spec.ts` assertions guard the ones added here.
- Large-table migrations that add STORED columns rewrite the table under an
  exclusive lock: schedule them.
