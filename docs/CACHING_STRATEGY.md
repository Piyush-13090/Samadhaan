# Caching Strategy (Prompt 27)

Samadhaan caches in Redis only, with short TTLs and keys that encode
everything that decides an answer, **including who is allowed to see it**.
Nothing is invalidated by event: every cache is either harmless to serve
slightly stale (seconds to minutes) or keyed so that a change produces a new
key. This document records what is cached, why, and the rules for adding a
cache. Prompt 27 measured the existing caches and added none: each measured
bottleneck was fixed at the query, so results are fast with caches off as well
(see [PERFORMANCE_BENCHMARKS.md](./PERFORMANCE_BENCHMARKS.md)).

## Inventory

| Cache | Key | TTL (default) | Scope / isolation | Why |
| --- | --- | --- | --- | --- |
| Search result lists | `search:list:v1:<sha256(scope, text, filters, place, sort, tz)>` | `SEARCH_CACHE_SECONDS` (120 s) | Public scope shared; private scope embeds the user id. Cursors carry the key; the server only honours a cursor equal to the key it recomputes. | Stable ordering across pages; keyword search with caches off was 568 ms p50 before Prompt 27 (161 ms after). |
| Public suggestions | `search:suggest:v1:<sha256(q)>` | 60 s | Public problems/organisations/sources only; private suggestions are never cached. | Type-ahead fan-out. |
| Query understanding (AI parse) | `search:aiparse:v1:<hash>` | 24 h | Parse of the query text only — no results. | LLM call avoided. |
| City list for parsing | `search:cities:v1` | 10 min | Public reference data. | |
| Query embeddings | `rag:qemb:v1:<sha256(text)>` | `RAG_QUERY_CACHE_SECONDS` (24 h) | A vector of the query text, not results; retrieval still runs the caller's access predicate. | Embedding is the AI service's CPU cost. |
| Analytics | hash of scope kind + organisation/user + jurisdiction + filters + range + timezone | `ANALYTICS_CACHE_SECONDS` (120 s); AI insights `ANALYTICS_INSIGHT_CACHE_HOURS` (6 h) | Per organisation / per user. | Aggregations; cached p95 ~15 ms vs ~50 ms uncached. |
| Leaderboard | `leaderboard:v1:<hash(params)>` | `LEADERBOARD_CACHE_SECONDS` (60 s) | Public. | |
| Geocoding | `geo:search:<provider>:<hash(query)>:<limit>`, `geo:reverse:<provider>:<lat>:<lng>` | 24 h | Public; query text is hashed, never stored in key names. | External provider quota and latency. |
| Search history / metrics | `search:recent:v1:…`, `search:metrics:v1:…` | per service | Per user (recent searches). | Not a performance cache. |

All caches are disabled or shortened under `NODE_ENV=test` where configured,
and every cache treats Redis errors as a miss (`.catch(() => null)`): a Redis
outage costs latency, never correctness.

## Invalidation

- **TTL-only.** A report changing status, a new vote or a new analysis shows up
  in cached search lists and analytics within one TTL (≤ 2 minutes by
  default). This was an explicit trade-off in Prompts 24–25 and is preserved.
- **Versioned prefixes** (`…:v1:`). A change to what a cached value means
  (shape, ranking, definitions) bumps the version; old entries expire on
  their own.
- **Model changes.** Query embeddings are keyed by text only but validated on
  read (dimension check) and carry their model and version; retrieval filters
  chunks by `embeddingModel`, so a model change never compares vectors across
  models. Bump `rag:qemb` when changing the embedding model.
- **Authorisation changes** (role removed, membership revoked, jurisdiction
  changed): private caches are keyed by user/organisation and the scope that
  produced them, so a changed scope computes a different key. A revoked user
  can no longer authenticate (`JwtAuthGuard` reads status from the database),
  so their cached entries are unreachable and expire.

## Rules for adding a cache

1. Measure the uncached path first. If the query can be made fast (index,
   stored column, smaller payload), do that instead — Prompt 27 did this for
   every finding.
2. Put **every** input that decides the answer in the key, including the
   authorisation scope. Never share a private result across users; never put
   raw user text in a key name (hash it).
3. Prefer short TTLs over event invalidation unless staleness is unacceptable;
   document the staleness window in this table.
4. Treat Redis failures as misses; never fail a request because the cache is
   down.
5. Make the TTL configurable (0 = off) so benchmarks can measure the uncached
   path (`ANALYTICS_CACHE_SECONDS=0 SEARCH_CACHE_SECONDS=0`).
6. Do not cache AI-generated content as if it were fact; cached AI outputs
   keep their provenance (model, version, generated-at).

## HTTP caching

API responses send `Cache-Control: no-store` (Prompt 26): they are
authenticated and per-user. Static web assets are content-hashed by Next.js
and cacheable indefinitely by the CDN/browser.
