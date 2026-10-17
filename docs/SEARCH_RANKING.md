# Search ranking

> **The ranking is an initial heuristic,** a transparent weighted sum of
> normalised signals. It is not a trained recommendation or ranking model,
> and it can later be replaced by one learned from feedback.

`SearchRankingService` (`apps/api/src/search/search-ranking.service.ts`).

## 1. Problems

| Signal | 0–1 value | Default weight (`SEARCH_WEIGHT_*`) |
| --- | --- | --- |
| Keyword | 0.6 × `ts_rank_cd` ÷ best in the list + 0.4 × share of query terms present; 0 if no term matched | 0.35 |
| Semantic | (cosine − 0.3) ÷ 0.7, clamped. 0.3 is `SEARCH_SEMANTIC_MIN_SIMILARITY` | 0.35 |
| Geographic | 1 − distance ÷ radius (only with a location) | 0.15 |
| Recency | 0.5^(age in days ÷ 30) (`SEARCH_RECENCY_HALF_LIFE_DAYS`) | 0.10 |
| Community | ln(1 + supporters) ÷ ln(51), capped at 1 | 0.05 |

```
score = Σ wᵢ·sᵢ / Σ wᵢ      over the signals that apply to this query
```

- **A signal that does not apply is left out** and the weights renormalise:
  no location, or semantic search unavailable. Scores stay comparable
  within one list; they are **not** comparable across different queries.
- **Ties** break on `publicId`, so order is deterministic.
- **Explanation.** Each result carries up to three plain reasons, strongest
  contribution first ("Matches your words", "Similar in meaning", "Near the
  place you searched", "Recently reported", "Supported by the community").
- **Explicit sorts** (newest, priority, severity…) reorder the same
  candidate set. The relevance score is still returned.
- **Filter browsing** (no text) does not score; it pages directly on the
  chosen sort. "Relevance" means nearest with a location, else newest.

## 2. Organisations

| Signal | Value | Weight |
| --- | --- | --- |
| Keyword | as for problems, over name (A), description (B), place (C) | 0.45 |
| Semantic | against the Prompt 14 profile embedding | 0.40 |
| Verified with matching expertise | 0.6 if verified, plus 0.4 if it has the queried expertise | 0.15 |

- **Order is relevance to the query only.** Organisations are never ranked
  against each other by performance.
- **Without text:** verified first, then by name.

## 3. Knowledge

- **Ranking reuses the Prompt 20 retrieval score:** semantic, keyword,
  source authority, context and recency (see
  [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md)), with diversity
  re-ranking.
- **Search adds a cap** of at most two passages per source.

## 4. Projects

- **Ordering:** `ts_rank_cd` over the project's name and description, plus
  0.5 × its problem's rank; then most recently updated.
- **Bounded:** only the caller's own projects are candidates, so the set is
  small.

## 5. Candidate bounds

- **Per channel:** at most `SEARCH_CANDIDATE_LIMIT` (200), so one query
  scores at most 400 problems.
- **Pages** are slices of the cached ranked list.

## 6. Tuning

- **Weights are configuration.** Change `SEARCH_WEIGHT_*` and restart. They
  need not sum to 1.
- **There is no click feedback yet,** so weights are not tuned from data.
  Search telemetry (zero-result rate, which filters are used) is the first
  evidence to use, and it holds no query text.
- **A learned ranker** would replace `combine()` behind the same interface.
