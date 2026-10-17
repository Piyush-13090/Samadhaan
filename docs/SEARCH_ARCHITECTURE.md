# Search architecture

Advanced search and discovery (Prompt 25). Ranking:
[`SEARCH_RANKING.md`](./SEARCH_RANKING.md). Access control and abuse
protection: [`SEARCH_SECURITY.md`](./SEARCH_SECURITY.md).

---

## 1. Pipeline

```
query ─▶ NestJS /search API (auth, validation, rate limits)
          └▶ query understanding: rules first, AI only for ambiguous text
               └▶ per entity, the access policy is inside every SQL query:
                    ├── keyword    PostgreSQL full text (GIN expression indexes)
                    ├── semantic   pgvector over existing embeddings (HNSW)
                    ├── filters    structured WHERE clauses
                    └── geography  PostGIS (ST_DWithin, bounding box)
               └▶ SearchRankingService: normalise, combine, order, explain
                    └▶ normalised results ─▶ /search page and GlobalSearch
```

- **The engine is PostgreSQL.** No Elasticsearch or OpenSearch: full text,
  vectors and geography live beside the data and its access rules. One
  query applies the access policy, the filters and the ranking.
- **No new tables.** The only database change is a set of full-text indexes
  (§3). Recent searches and telemetry live in Redis.

## 2. Modules

| File (`apps/api/src/search/`) | Role |
| --- | --- |
| `search.controller.ts` | `GET /search`, `/search/{problems,organizations,knowledge,projects,suggest,recent,metrics}` |
| `search.service.ts` | Orchestration. The unified endpoint reads the query once and fans out to every entity in parallel |
| `search-query-parser.ts` | Deterministic query understanding (pure) |
| `search-query-understanding.service.ts` | Known cities, plus the AI fallback with budget and cache |
| `search-authorization.service.ts` | One explicit access policy per entity, as SQL |
| `problem-search.service.ts` | Hybrid problem search; keyset browsing without text |
| `organization-search.service.ts` | Public organisation profiles; keyword, semantic and expertise |
| `knowledge-search.service.ts` | The Prompt 20 retriever, re-checked; keyword-only fallback |
| `project-search.service.ts` | Participants' projects only |
| `search-ranking.service.ts` | Weighted, explainable ranking |
| `search-highlight.ts` | Highlight segments (never HTML) and excerpts |
| `search-suggestion.service.ts` | As-you-type suggestions (no embeddings, no AI) |
| `search-history.service.ts` | Recent searches and anonymous telemetry |
| `search-cache.service.ts`, `search-cursor.ts` | Ranked-list cache and opaque cursors |

**AI service.** `POST /search/understand` takes one query and returns
enum-bounded filters.

**Web:**

- `components/search/global-search.tsx`: the top-bar combobox.
- `components/search/search-page.tsx`, `search-filter-panel.tsx` and
  `search-result-card.tsx`.
- `lib/search.ts`: URL state.
- The `/search` route.

## 3. PostgreSQL full-text search

GIN expression indexes are kept in `prisma/sql/post-migrate.sql`, because
Prisma cannot express them. The queries use **exactly** the same expressions
(`search-sql.ts`), so the planner can use the indexes. An e2e test checks
this with `EXPLAIN`.

| Index | Expression |
| --- | --- |
| `problems_search_vector_gin` | on the stored generated column `problems."searchVector"` (Prompt 27, migration `20261017090000_search_vector`): title and subcategory (weight A), description (B), address, city, state and postal code (C, `simple` dictionary). Stored so ranking does not recompute `to_tsvector` per row — see `docs/PERFORMANCE_AUDIT.md` |
| `problem_ai_analyses_summary_fts` | AI summary |
| `organizations_search_fts` | name (A), description (B), city and state (C) |
| `resolution_projects_search_fts` | name and description |
| `knowledge_sources_title_fts` | source title (suggestions) |

Knowledge chunks had `knowledge_chunks_content_fts` (Prompt 20); since Prompt 27 they use a stored generated column `contentVector` with GIN index `knowledge_chunks_content_vector_gin`.

**Query construction:**

- **Search:** an any-term query (`plainto_tsquery` with `&` turned into `|`).
  A report that says "drain blocked" still matches "blocked drain sector 12".
  Ranking rewards covering more of the query: `ts_rank_cd` combined with
  term coverage.
- **Suggestions:** a prefix query on the last word (`drai` → `drai:*`). Only
  letters and digits reach `to_tsquery`.
- **No `LIKE '%…%'` scans** anywhere.

## 4. Semantic search

- **The query** is embedded by the existing embedding service. The cached
  `KnowledgeRetrievalService.embedQuery` is reused, keyed by the text alone.
- **Problems** are matched against the existing `problem_embeddings` (TEXT,
  same model).
- **Organisations** are matched against the Prompt 14
  `organization_embeddings`.
- **Knowledge** uses the Prompt 20 hybrid retriever.
- **Filtered HNSW.** The search runs with `hnsw.iterative_scan =
  relaxed_order` so access filters do not starve the result.
- **Thresholds and limits.** Candidates below
  `SEARCH_SEMANTIC_MIN_SIMILARITY` (0.3) are dropped. Each channel returns
  at most `SEARCH_CANDIDATE_LIMIT` (200).
- **If embeddings are unavailable,** search continues with keyword matching
  only. `signals` in the response says which channels ran.
- **Suggestions never use embeddings.**

## 5. Query understanding

**Rules first** (`parseSearchQuery`, pure and unit-tested). They read:

| Cue | Becomes |
| --- | --- |
| "NGOs", "universities", "organisations"… | entity Organisation, plus type |
| "guidelines", "policy"… / "projects" | entity Knowledge / Project |
| "problems", "issues", "complaints" | entity Problem |
| Category words from the taxonomy (`CATEGORY_TERMS`) | `category`, **only** when followed by a problem noun or nothing else is left, or for "working on X" with organisations |
| "critical" / "severe" / "minor" / "urgent" / "high priority" | severity, urgency, priority |
| "verified", "resolved", "unresolved", "in progress", "rejected" | status filters |
| "this month", "last 7 days", "today", "this year"… | a date range in the reporting time zone |
| A known city (from the database), a 6-digit postal code, "within N km" | place filters |
| "near me" | `needsLocation`. The UI offers "Near me" |

- **Precedence:** explicit URL parameters always win over words.
- **Visible in the response.** `understanding.applied` lists what was read;
  the UI shows it as chips with "Search the exact words instead"
  (`interpret=false`).
- **Relaxed retry.** If filters read from the words leave no results, the
  plain text is searched once more and labelled "No exact matches, but these
  may be relevant".
- **AI fallback.** Only when the rules found nothing in a query that reads
  like natural language (4+ words with cues such as "where", "show me").
  Only on a submitted search, never for suggestions. It has a per-user hourly
  budget (`SEARCH_AI_PARSE_PER_HOUR`) and is cached for 24 hours by query.
  - **Output:** enum-bounded filters and a semantic rewrite, validated twice
    (Python schema, then NestJS against the taxonomy and known cities).
  - **On failure** search proceeds with the text.

## 6. Pagination and sorting

- **With query text.** The ranked list for the request is computed once and
  cached for `SEARCH_CACHE_SECONDS`. Cursors are positions in that list,
  bound to its key, so the server rejects a cursor from another search. No
  deep OFFSET reaches SQL, and the list is bounded.
- **Without text (filter browsing).** Problems page by keyset on the sort
  expression and `publicId`, so any depth stays cheap.
- **Sorts:** relevance, newest, oldest, priority (effective tier), severity,
  most supported, nearest (needs a location).
- **The UI offers only sorts that make sense,** and the API returns 400 for
  "nearest" without one.

## 7. Geographic search

- **Inputs:**
  - `lat`/`lng` with `radiusKm` (0.5–50, default 5), using `ST_DWithin` on
    the GiST index;
  - `bbox` (at most 5° wide);
  - `city`, `state` and `postalCode`.
- **No coordinates in results.** Results carry `distanceKm` rounded to
  0.1 km. "Near me" rounds the browser's position to ~100 m before it leaves
  the device.

## 8. Caching

| What | Key | TTL |
| --- | --- | --- |
| Ranked problem / organisation lists | scope (`public` or an office's jurisdiction hash) + text + effective filters + place + sort + zone | `SEARCH_CACHE_SECONDS` (120) |
| Ranked project lists | `user:{id}` + predicate hash + text | same |
| Public suggestions | prefix | 60 s |
| Query embeddings | text hash | `RAG_QUERY_CACHE_SECONDS` |
| AI query readings | query hash | 24 h |
| Known cities | — | 10 min |

- **Not cached:** knowledge results and knowledge suggestions, which depend
  on the user's scope.
- **No sharing of private results.** A private list is never shared:
  project keys embed the user.

## 9. Telemetry

- **Daily Redis counters only** (`search:metrics:v1:{date}`, kept 35 days):
  query count, zero results, entity type, latency band, which filters were
  used, and whether semantic search or AI parsing ran.
- **No query text and no user ids.** Administrators read it at
  `GET /search/metrics`.

## 10. Future scalability

- **The ranking is heuristic.** It can be replaced by a learned ranker
  (learning-to-rank on click and feedback data) without changing the API:
  ranking is one service.
- **When PostgreSQL search needs help:**
  - first, `tsvector` generated columns;
  - then materialised summary vectors;
  - only with measured need, a dedicated search engine fed by the same
    access policies.

  Prompt 27 owns performance work.
