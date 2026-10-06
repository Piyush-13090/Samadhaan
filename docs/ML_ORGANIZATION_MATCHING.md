# Organisation Matching

How Samadhaan finds the NGOs, universities and industry partners that may be
able to help with a civic problem — and what that finding does and does not
mean.

> **The current implementation is an embedding-assisted heuristic baseline
> designed to establish the matching pipeline. It is not yet a trained
> supervised recommendation model.** Its signals are real — text embeddings
> from a sentence-transformer, PostGIS distance, the shared problem taxonomy —
> but they are combined by hand-chosen weights, not learned ones. There is no
> outcome data to learn from yet.

---

## 1. What a match means

A match says an organisation is **potentially relevant** to a problem. Nothing
more.

It does not assign, allocate, approve, endorse or notify. No organisation is
told it has been matched; no citizen is told an organisation will act.
Government allocation, organisation applications and resolution are later,
human workflows. The UI says "Organisations that may be able to help" and
"Recommended civic opportunities — suggestions, not assigned projects".

The score is **relevance**, shown as "92% relevance". It is a weighted average
of interpretable signals, **not** a calibrated probability, so it is never
labelled confidence.

## 2. Architecture

```
Problem submitted ── AI analysis ── AI_ANALYSIS_COMPLETED / _FAILED event
                                          │
                     OrganizationMatchingService (NestJS, in-process queue)
                                          │
  1. Problem embedding     reused from duplicate detection (problem_embeddings),
                           created once if absent
  2. Candidate retrieval   one SQL statement: pgvector top-K over
                           organization_embeddings ∪ organisations declaring the
                           problem's category; eligibility; PostGIS distance
  3. Inputs                expertise and activity counts for all candidates,
                           batched (2 queries)
  4. Scoring + ranking     POST /match/organizations (FastAPI) — features,
                           MatchingEngine, diversity
  5. Persistence           organization_problem_matches, one transaction;
                           job provenance in problem_ai_analyses
```

Responsibilities are split as Prompt 14 asks:

| NestJS | FastAPI |
| --- | --- |
| Triggers, queue, retrieval (pgvector + PostGIS), eligibility, persistence, versions, authorisation, every API | Feature processing, phrase-level embeddings, the scoring engine, ranking and diversity |

The AI service never touches the database and never sees vectors, coordinates,
people or contact details. It receives the problem's public text and taxonomy,
and per candidate: type, declared expertise, the cosine similarity pgvector
computed, distance in metres, a same-city flag and an activity count. Every
response is validated in `parseMatchResponse` before anything is written; an
organisation that was not offered as a candidate is rejected.

## 3. Embeddings

**Provider.** The existing `EmbeddingProvider` abstraction in the AI service
(`EMBEDDING_PROVIDER`, default `sentence-transformers` with
`all-MiniLM-L6-v2`, 384 dimensions, normalised). Another provider is one new
class; no business logic changes.

**Problems.** The canonical text duplicate detection already embeds — title,
description, category, subcategory, locality (`buildCanonicalText`). Matching
reads that row; it only encodes a problem itself when none exists, and stores
the result in the same table for both features.

**Organisations.** `organization_embeddings`, mirroring `problem_embeddings`.
The text (`buildOrganizationProfileText`) is name, type, description and areas
of work. Contact details, people and location are deliberately excluded —
location is its own signal, and embedding the city as well would count
geography twice.

**Freshness by content hash.** `sourceHash` is the SHA-256 of that exact text.
`OrganizationEmbeddingService.refresh` compares hashes and calls the encoder
only when they differ: editing a phone number re-embeds nothing; editing the
description or expertise always re-embeds.

**Index.** HNSW, `vector_cosine_ops`, on both tables (declared in the
migration and in `prisma/sql/post-migrate.sql`, because Prisma cannot express
it). HNSW needs no training pass, which suits tables growing from empty. At
today's scale — tens of organisations — PostgreSQL may choose a sequential
scan, which is correct for small tables; the index takes over as they grow.
Retrieval filters eligibility in the same statement; pgvector 0.8's iterative
index scans keep that filtered `ORDER BY … LIMIT` efficient. **Model changes:**
vectors from different models are never compared (the query is scoped by
`modelName`); after changing `EMBEDDING_MODEL`, organisations are re-embedded
by the startup sweep only if they have no embedding, so re-embed explicitly.

## 4. Candidate retrieval

Two-stage, never all-against-all:

- **Stage 1 (SQL).** The `MATCHING_CANDIDATE_LIMIT` (default 40) nearest
  organisation profiles by cosine distance, **unioned with** up to the same
  number of organisations that declare the problem's category (reporter's or
  AI's). The union is what keeps a new or sparsely described organisation —
  or one whose embedding failed — visible to problems squarely in its field.
- **Eligibility**, in the same statement: not deleted, `isActive`, type NGO /
  UNIVERSITY / INDUSTRY (government offices are never matched), verification
  not `SUSPENDED` or `REJECTED`. `PENDING` organisations **are** eligible —
  verification takes time and must not make a newcomer invisible; the UI shows
  their status.
- **Stage 2 (AI service).** Detailed scoring of those ≤ 80 candidates; the top
  `MATCHING_RESULT_LIMIT` (default 10) at or above `MATCHING_MIN_SCORE`
  (default 0.35) are kept.

## 5. Signals

Each 0–1, or null when it could not be computed.

| Signal | What it measures | How |
| --- | --- | --- |
| **semantic** | The problem against the organisation's whole profile | pgvector cosine, rescaled from the band [0.10, 0.60] to [0, 1] |
| **expertise** | The best declared area of work, weighted by level | per area: max(category compatibility, phrase similarity) × level weight (specialist 1.0, experienced 0.85, interested 0.6) |
| **category** | Taxonomy compatibility | 1 same category; 0.6 same family; else 0. The AI's category counts at 0.9 when it differs from the reporter's |
| **geographic** | Distance to the registered location | exp(−d / 25 km); 0.6 same city without coordinates; **0.3 neutral** when the organisation has no location |
| **capability** | Fit of the organisation *type* to the problem | similarity of the problem text to a plain description of what NGOs / universities / industry do |
| **activity** | Related past contributions | 0.5 + 0.5 × min(1, suggestions on same-category problems / 3) |

**Phrase similarity** is the problem's text against each expertise phrase
("Flood mapping. Stormwater and sewage drainage, waterlogging…"), encoded by
the same model and cached per process. It lets "flood mapping" match a
waterlogging report even across categories.

**Category families** (`app/matching/features.py`) describe which parts of the
taxonomy share skills and institutions — mobility, water, sanitation, energy,
environment, public space, safety. They are taxonomy structure, not rules about
organisation types.

**Organisation type** is never a rule ("roads = industry"). It is the
capability signal: a semantic comparison with descriptions of what each type of
organisation does, at 5% weight.

## 6. Baseline scoring — initial weights

```
relevance = Σ wᵢ · signalᵢ / Σ wᵢ      (over the signals that are available)

  semantic   0.35
  expertise  0.30
  category   0.15
  geographic 0.10
  capability 0.05
  activity   0.05
```

**Initial heuristic baseline.** These weights are a design statement — what
the problem is about and what the organisation does dominate; geography and
history are weak — not the output of any optimisation. Configure them with
`MATCHING_WEIGHT_*` in the AI service's environment.

A missing signal (no embedding yet; encoder down) has its weight redistributed
over the others rather than being scored as zero, so a missing input never
reads as a bad match. The response lists such signals in `degraded`.

## 7. Ranking and diversity

Candidates are sorted by relevance, ties broken by id. Light diversity then
applies **only when it costs no relevance**: an organisation of a type not yet
in the list may replace the weakest entry of an over-represented type, if its
own relevance is at least 0.5 and at least 80% of the best. It is never forced
in, and the final list is re-sorted by relevance.

## 8. Explanations

The engine emits reason codes from the signals that fired —
`EXPERTISE_STRONG` (expertise ≥ 0.75), `EXPERTISE_RELATED` (≥ 0.45),
`SEMANTIC_HIGH` (≥ 0.7), `SEMANTIC_MODERATE` (≥ 0.45), `WITHIN_SERVICE_AREA`
(≤ 25 km, with the distance), `SAME_CITY`, `IN_REGION` (≤ 100 km), `TYPE_FIT`
(capability ≥ 0.6), `RELATED_ACTIVITY` — plus the declared areas of work that
scored at least 0.6 on their own. The web app turns those into sentences
(`lib/matching.ts`). No LLM writes any explanation, and nothing resembling
model reasoning is stored or shown.

## 9. Persistence, versions and freshness

`organization_problem_matches` stores every signal, the composite, the rank,
the explanation evidence, the embedding model and the **matching version**:
`heuristic-baseline@1.0.0+<hash>`, where the hash covers every weight and
threshold. Change a weight and the version changes. Unique on
`(problemId, organizationId, matchingVersion)`.

Each run replaces all of the problem's non-dismissed rows in one transaction,
so a newer version never sits beside an older one. Job state and provenance —
candidate count, matched count, degraded signals, weights, timings — are an
`ORGANIZATION_MATCHING` row in `problem_ai_analyses`, like every other AI job.

Statuses: `CALCULATED`, `STALE` (an input changed; still shown, marked "being
refreshed"), `DISMISSED` (the organisation marked it not relevant; survives
re-matching). There are deliberately no acceptance or allocation statuses.

**When matching runs** — only when an input changed:

| Change | Effect |
| --- | --- |
| A problem's AI analysis completes or fails | that problem is matched |
| An organisation's name, description, expertise or location changes (`ORGANIZATION_PROFILE_CHANGED`, debounced 2 s) | re-embed if the text changed; its matches → `STALE`; re-match the problems it matched, the nearest open problems to its profile and recent problems in its categories (bounded) |
| A problem stops being open work (duplicate, resolved, rejected…) | its next run deletes its non-dismissed matches; reads already exclude it |
| API start (`MATCHING_SWEEP_ON_STARTUP`) | embed organisations without embeddings; re-match problems with stale or no matches, up to `MATCHING_SWEEP_LIMIT` |
| Admin | `POST /problems/:publicId/matches/recompute` |

Opening a page never computes anything.

**Background processing.** An in-process queue with `MATCHING_CONCURRENCY`
(default 2) workers — the same detached-job model as analysis and duplicate
detection, no new queue technology. Calls for a problem already running
coalesce into one follow-up run. Problem creation never waits on it.

## 10. Cold start and fairness

- **No history required.** Activity starts at a neutral 0.5 and can add at
  most half of a 5% weight. An organisation with no past contributions is
  scored on what it does and where.
- **No location required.** Unknown location scores a neutral 0.3, not 0.
- **No embedding required.** The category path in retrieval and the
  redistributed weights keep an organisation whose embedding failed in play.
- **Pending verification is eligible**, and displayed as such.
- **Not used, by design:** followers, member counts, organisation size,
  popularity, previous engagement volume. Expertise and the problem's own
  content are the primary signals, so a large organisation cannot dominate
  every list by being large.
- Geography can never outrank relevance: a specialist 1,200 km away still
  outscores an irrelevant organisation next door (tested).

## 11. Development evaluation set

`services/ai/evaluation/organization_matching_dev.json` — eight organisations,
six problems, graded labels (2 = clearly relevant, 1 = partly). It is a
**development evaluation set**: small, hand-written and deterministic. It
catches regressions and nonsense rankings. It is **not** a production
benchmark and says nothing about real-world accuracy.

```
services/ai/.venv/bin/python -m evaluation.organization_matching   # from services/ai
```

With `all-MiniLM-L6-v2` and the initial weights (6 Oct 2026):

| Problem | P@1 | NDCG@3 | Top three |
| --- | --- | --- | --- |
| Pothole, Sector 48 | 1 | 1.00 | RoadSafe 0.83, PathFix (Mumbai) 0.62, Mobility Lab 0.52 |
| Overflowing bins | 1 | 0.83 | CleanCity 0.71, Aqua 0.41, Hydrology 0.38 |
| Waterlogging | 1 | 1.00 | Hydrology 0.85, Aqua 0.70, CleanCity 0.46 |
| Streetlights out | 1 | 1.00 | Brightway 0.82, RoadSafe 0.52, Mobility Lab 0.52 |
| Burst pipe | 1 | 1.00 | Aqua 0.82, Hydrology 0.74, RoadSafe 0.34 |
| Open burning in park | 1 | 1.00 | GreenParks 0.74, CleanCity 0.72, Aqua 0.30 |

Mean P@1 1.00, mean NDCG@3 0.97. `SAMADHAAN_RUN_MODEL_TESTS=1` runs the same
check in pytest (P@1 = 1, NDCG@3 ≥ 0.9); a model-free variant runs always.

## 12. Replacing the baseline with a trained model

`MatchingEngine` (`app/matching/engine.py`) is the seam: `score(problem,
candidates, text) → ScoredCandidate[]`, plus `name`, `version`, `trained` and
`weights`. A learned engine — e.g. gradient-boosted learning-to-rank over these
same six signals — implements it, sets `trained = True`, and gets a new
matching version automatically. Retrieval, persistence, APIs and UI do not
change. Training data would come from later milestones: allocations,
organisation interest, resolution outcomes, and dismissals (already recorded).
Because every signal is stored per row, a trained model can be evaluated
against this baseline on identical inputs.

## 13. Observability

API logs: matching started (with trigger), candidate retrieval count, matching
completed (stored/candidates, version, duration), matching failed (code),
organisation embedding updated/failed, sweep totals. AI service logs:
`organization_matching_completed` with candidate and match counts, degraded
signals, version, duration. Neither logs problem text, organisation contact
details, people, vectors or tokens.

## 14. Known limitations

- Weights are hand-chosen; there is no outcome data to tune or train on.
- The capability signal is weak with MiniLM — type descriptions are generic,
  so it is usually near zero and mostly lowers absolute scores slightly.
- The development set has 14 organisation–problem labels; it cannot measure
  real accuracy.
- Organisations declare expertise themselves; nothing verifies it yet.
- The service area is a radius around one point; organisations cannot draw a
  boundary.
- Changing `EMBEDDING_MODEL` needs an explicit re-embedding of organisations.
- The queue is in-process: a restart drops queued jobs; the startup sweep
  re-queues problems that never completed.
- The sentence-transformer encodes one batch at a time per process (concurrent
  `encode` calls crash Apple's MPS backend — fixed in this milestone with a
  lock); throughput is bounded by that.
