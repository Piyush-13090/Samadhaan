# Duplicate Detection

How Samadhaan decides that a new report may describe a civic problem somebody
has already reported — and, just as importantly, what it refuses to decide.

> **Status: implemented.** Text embeddings, pgvector retrieval, PostGIS
> distance, multi-signal scoring, persistence and the citizen-facing review flow
> all run. Image similarity does not — see §6. A learned scorer does not — see
> §13.

---

## 1. Problem definition

Given a newly submitted problem *P*, find existing problems that describe **the
same real-world issue**, and rank them by how likely that is.

Three things this is deliberately not:

- **Not near-duplicate text detection.** Two reports of the same pothole rarely
  share vocabulary; two reports of different potholes on the same road often do.
- **Not automatic merging.** The system's strongest verdict is
  `LIKELY_DUPLICATE`, which is a prompt for a person. Nothing merges without a
  human decision (§14).
- **Not a blocker.** The report is committed before the check runs, and a failed
  check cannot touch it. A citizen is never prevented from filing.

### Positive pair

Two reports that a reasonable reviewer would say describe the same physical
problem at the same place. The canonical example:

| | Problem A | Problem B |
| --- | --- | --- |
| Title | Large pothole near Sector 12 market | Road has a huge pothole outside Sector 12 market |
| Distance | — | 40 m |
| Filed | day 0 | day 2 |

### Negative pair

Anything else, including the three cases that matter most because they *look*
positive to a naive matcher:

1. **Same words, different place.** The same pothole description filed 230 km
   away. Handled by the proximity gate (§6).
2. **Same place, different problem.** A pothole and a broken streetlight at one
   junction. Handled by the category gate (§9).
3. **Same place, same category, different instance.** Two genuinely different
   potholes 400 m apart on one road. The hardest case, and the one the current
   heuristics are weakest at — it is the primary motivation for §13.

---

## 2. Pipeline

Cheap filters first, expensive scoring last. Nothing loads the corpus into
Node; nothing compares every pair.

```
new problem
   │
   ├─▶ canonical text  (§4)
   ├─▶ embedding       (§3)  → stored in problem_embeddings
   │
   ├─▶ retrieval       (§11) one SQL query: pgvector ANN + PostGIS radius
   │                          + eligibility + direction, LIMIT 20
   │
   ├─▶ scoring         (§10) five signals, renormalised, two gates
   ├─▶ thresholds      (§12) likely / possible / related / discard
   │
   ├─▶ persistence     problem_duplicate_candidates, ≤ 5 rows
   └─▶ UI              citizen confirms or rejects (§14)
```

Implementation: `apps/api/src/problems/services/duplicate-detection.service.ts`
(pipeline) and `duplicate-scoring.service.ts` (scoring, pure).

---

## 3. Embedding model

| | |
| --- | --- |
| Provider | `sentence-transformers`, running **locally inside the AI service** |
| Model | `sentence-transformers/all-MiniLM-L6-v2` |
| Dimensions | 384 |
| Normalisation | L2, so cosine similarity is a dot product |
| Cost | none per report |

**Why local rather than a hosted embedding API.** Deduplication runs on every
submitted report, so a per-call price makes the cost of the feature scale with
civic participation — exactly the wrong incentive for a platform whose goal is
more reporting. A 22M-parameter encoder is also genuinely adequate for short
descriptive text; the quality gap against a hosted 1536-dimensional model does
not justify that trade. It works offline and in CI, with no key.

Measured separation on the canonical example (`SAMADHAAN_RUN_MODEL_TESTS=1`):

| Pair | Cosine |
| --- | --- |
| Pothole A vs pothole B (positive) | **0.76** |
| Pothole A vs waterlogging, same market | 0.45 |
| Pothole A vs streetlight (negative) | **0.18** |

### Model versioning

Every row in `problem_embeddings` records `modelName`, `modelVersion` and
`dimensions`, and retrieval filters on `modelName`. **Vectors from different
models are never compared** — a cosine between them is a meaningless number that
looks exactly like a meaningful one.

Changing `EMBEDDING_MODEL` therefore requires:

1. A migration if the width changes — the column is `vector(N)` and pgvector
   cannot index a mixed-width column.
2. A re-embed. Old rows are not deleted; they simply stop matching the filter
   and become invisible to retrieval until re-encoded.
3. No code change. `EmbeddingProvider` (`services/ai/app/providers/`) is the
   only place that knows which model is loaded.

---

## 4. Canonical text

What gets embedded:

```
<title>
<description>
Category: <CATEGORY>
Issue: <subcategory>
<city>, <state>
```

**Never embedded:** reporter name, email, phone, user id, account state, or
coordinates. An embedding is a reconstructable representation of its input, so
anything placed here is effectively retained in a form similarity search can
surface. Locality is included because "Sector 12 market" genuinely disambiguates
two potholes; coordinates are excluded because the geographic signal measures
that far better than text ever could.

Enforced by tests in `duplicate-detection.service.spec.ts`.

---

## 5. Text similarity

Cosine similarity between the two problems' text embeddings, computed in
PostgreSQL as `1 - (a <=> b)` where `<=>` is pgvector's cosine distance.

A pre-filter of `DUPLICATE_MIN_TEXT_SIMILARITY` (0.35) discards candidates too
dissimilar to reach any threshold, before a PostGIS distance is computed for
them.

---

## 6. Image similarity — **not implemented**

There is no image encoder, and **no fabricated image vectors anywhere**. The
signal is reported as `null`, and the scorer renormalises its weights over the
signals that do exist (§10). `EmbeddingProvider.embed_images` is declared and
raises `CAPABILITY_UNAVAILABLE`.

This is a correctness decision, not laziness: a similarity computed from a
fabricated vector is indistinguishable from a real one, so it would silently
corrupt every duplicate decision it touched. A missing signal is visible in
`confidence`; a fake one is not visible anywhere.

**What implementing it requires.** A CLIP-class encoder produces 512-dimensional
vectors, which do not fit the 384-wide column. The chosen exit is a **second
table at its native width** (`problem_image_embeddings`, `vector(512)`, its own
HNSW index) rather than projecting into the text column — projection loses
information and couples two unrelated models to one width. Once it exists, the
scorer needs no change: it already handles the signal being present.

---

## 7. Geographic similarity

PostGIS `ST_Distance` on the `geography(Point,4326)` column, converted to a
similarity by half-value decay:

```
geo = 0.5 ^ ((distance / DUPLICATE_GEO_RADIUS_METERS)²)
```

| Distance | Similarity |
| --- | --- |
| 0 m | 1.00 |
| 375 m | 0.84 |
| **750 m** (the radius) | **0.50** |
| 1500 m | 0.06 |
| 2250 m | 0.002 |

Chosen over a linear ramp because the interesting region is the first hundred
metres — GPS drift and a mis-dropped pin both live there — and a linear function
spends most of its range on distances that are already clearly unrelated.

### The proximity gate

Geography is **not merely a weighted signal**. Two reports describe the same
physical pothole only if they are in the same place, so distance can veto in a
way word choice cannot.

A plain weighted average cannot express that. With the default weights,
identical text 500 km apart scores **0.66** — a "possible duplicate" — because
strong text similarity outvotes a near-zero geographic signal. That is nonsense,
and it is why the additive blend is multiplied by:

```
proximityGate = min(1, geo / DUPLICATE_GEO_GATE_FLOOR)      # floor = 0.25
```

Fully open at ~1.4× the radius and closing linearly below that. A location that
was never measured does not gate — a signal that does not exist cannot veto.

`DUPLICATE_MAX_DISTANCE_METERS` (5 km) is a second, harder filter applied during
retrieval, so distant candidates are never scored at all.

---

## 8. Temporal similarity

```
temporal = floor + (1 - floor) × 0.5 ^ (ageGapDays / halfLife)
```

with `halfLife = 120` days and `floor = 0.35`.

| Gap | Similarity |
| --- | --- |
| 0 days | 1.00 |
| 120 days | 0.68 |
| 1 year | 0.39 |
| 5 years | 0.35 (floor) |

**The floor is the important part.** A pothole unrepaired for two years is still
the same pothole when somebody reports it again. Age must be able to lower a
score without ever making an old problem unmatchable — so this is a supporting
signal, never a hard rule. It also carries the smallest weight of the five.

---

## 9. Category similarity

Exact match scores 1. Otherwise a hand-written affinity table:

| Pair | Score | Why |
| --- | --- | --- |
| ROADS ↔ POTHOLES | 0.90 | The same defect under either heading |
| GARBAGE ↔ SANITATION | 0.85 | Almost total overlap |
| DRAINAGE ↔ WATER | 0.75 | Standing water is reported as both |
| STREETLIGHTS ↔ ELECTRICITY | 0.70 | An unlit street is either, depending on the reporter |
| TRAFFIC ↔ ROADS | 0.60 | Road problems with a different emphasis |
| PUBLIC_SAFETY ↔ DRAINAGE / ROADS | 0.50 | An open drain is filed under safety as often as drainage |
| `OTHER` ↔ anything | 0.40 | Where a reporter lands when no heading fits |
| Anything else | 0.10 | Never 0 |

This is domain knowledge about Indian municipal categories, deliberately written
down in one table rather than learned from data that does not exist yet.

### The category gate

The same necessity argument as §7, on the other axis. In a dense market area,
geography and recency both score near 1 for *every* pair, which alone is enough
to drag an unrelated pair over the related threshold — a pothole report
surfacing a waterlogging report purely because both are in Sector 12.

```
categoryGate = min(1, category / DUPLICATE_CATEGORY_GATE_FLOOR)   # floor = 0.40
```

Every pairing in the affinity table (minimum 0.50) clears the floor untouched;
only the 0.10 "unrelated" case is suppressed. Category still carries the
**smallest** additive weight, so the gate can veto a pair but can never carry
one — "same category" alone never makes a duplicate.

---

## 10. Scoring

```
blend = Σ(wᵢ × sᵢ) / Σ(wᵢ)        over signals that are available
score = blend × proximityGate × categoryGate
```

### Initial heuristic weights

| Signal | Weight |
| --- | --- |
| Text | 0.35 |
| Image | 0.25 |
| Geographic | 0.25 |
| Category | 0.10 |
| Temporal | 0.05 |

**These are starting heuristics chosen by hand, not learned parameters.** They
live in configuration (§15) because they are expected to be retuned.

### Renormalisation

An unavailable signal is **omitted from both sums**, never scored 0. Today that
means the image weight is redistributed across the other four on every pair.
Scoring a missing image as zero would penalise every report for a capability the
platform does not have — the difference between "we did not look" and "we looked
and found nothing alike".

### Confidence

Distinct from the score, and reduced by two independent things:

```
confidence = coverage × agreement
coverage   = Σ(available weights) / Σ(all weights)
agreement  = 1 - 2 × weighted mean absolute deviation from the blend
```

- **Coverage** — a score computed without images rests on less evidence than one
  computed with them, and saying so is more honest than renormalising and
  claiming equal certainty.
- **Agreement** — text at 0.95 and geography at 0.10 average to something
  middling that reads as a moderate match, when the evidence is actually in
  conflict and the average is the least informative summary of it.

The gates are deliberately excluded from confidence: they are a statement about
plausibility, not about evidential strength.

### Determinism

`score()` is a pure function of `(signals, config)` — no clock, no randomness, no
database. Ranking ties break on `publicId`, so two runs over the same data
produce byte-identical output. This is what makes thresholds testable at all.

---

## 11. Candidate retrieval

One SQL statement (`findCandidates`) does all of it:

```sql
SELECT ..., 1 - (e.embedding <=> $vec) AS "textSimilarity",
       ST_Distance(c.location, target.location) AS "distanceMeters"
FROM problem_embeddings e
JOIN problems c ON c.id = e."problemId"
CROSS JOIN (SELECT location, "createdAt" FROM problems WHERE id = $id) target
WHERE e."embeddingType" = 'TEXT'
  AND e."modelName" = $model            -- never compare across models
  AND c.id <> $id
  AND c."deletedAt" IS NULL
  AND c."duplicateOfId" IS NULL         -- point at canonical reports, not chains
  AND c.status <> ALL ($ineligible)
  AND c."createdAt" <= target."createdAt"   -- direction: newer checks older
  AND ST_DWithin(c.location, target.location, $maxDistance)
  AND 1 - (e.embedding <=> $vec) >= $minText
ORDER BY e.embedding <=> $vec
LIMIT 20
```

### Eligibility rules

| Status | Eligible | Why |
| --- | --- | --- |
| `DRAFT` | ✗ | Never published |
| `REJECTED` | ✗ | Judged not to be a real problem |
| `DUPLICATE` | ✗ | Already merged; matching it builds chains of duplicates-of-duplicates |
| `ARCHIVED` | ✓ | **Deliberately searchable** — an archived pothole that resurfaces is exactly the case worth surfacing |
| `RESOLVED` | ✓ | Same reasoning: problems recur |
| Everything else | ✓ | |

### Direction

The row records "newer `problemId` may duplicate older `candidateProblemId`",
enforced by `createdAt <= target.createdAt`. Merging is directional — the older
report is canonical and accumulates supporters — so a normalised undirected pair
would lose the one fact the merge needs. The unique index on
`(problemId, candidateProblemId)` prevents a pair being stored twice.

### Retraction

A re-check **deletes** stored candidates it no longer supports, except those a
human has ruled on. Without this, re-checking is purely additive: retuned
thresholds or a better model would leave every previously-suggested pair on
screen forever.

---

## 12. Thresholds

| Combined score | Verdict | Wording shown |
| --- | --- | --- |
| ≥ 0.85 | `LIKELY_DUPLICATE` | "Likely the same problem" |
| ≥ 0.65 | `POSSIBLE_DUPLICATE` | "Possibly the same problem" |
| ≥ 0.50 | `RELATED` | "Related problem nearby" |
| < 0.50 | discarded | nothing shown |

The UI never says "this is a duplicate". AI similarity is probabilistic, and the
wording states a claim with a strength rather than a verdict.

Only `LIKELY_DUPLICATE` writes the `LIKELY_DUPLICATE` row status; everything else
is stored `PENDING`.

---

## 13. Toward a learned scorer

The weights above are hand-chosen. Replacing them with a model trained on
labelled pairs is **Prompt 28**, and the architecture is already shaped for it:

- `DuplicateScoringService.score()` takes its entire configuration as an
  argument. A learned model supplies a different `DuplicateDetectionConfig`, or
  replaces the combination step, without touching retrieval, persistence or UI.
- Every scored pair is persisted **with its component signals**, not just the
  combined score. That table is the feature store.
- Human verdicts are persisted as labels: `CONFIRMED_DUPLICATE` is a positive,
  `NOT_DUPLICATE` and `REJECTED` are negatives. **Rejections are never deleted**
  — confirmed negatives are the scarcer and more valuable half of the training
  data, and deleting them would also mean re-suggesting the same rejected pair.

A learned combiner (logistic regression or gradient-boosted trees over the five
signals plus distance and age) is the natural first step; it needs on the order
of a few thousand labelled pairs, which accrue from the review flow.

**Not trained yet, and deliberately so** — there is no labelled data, and a model
fitted to invented labels would be worse than the transparent heuristics it
replaced.

---

## 14. Human decision

The detector's ceiling is `LIKELY_DUPLICATE`. Nothing on the scoring path can
write `CONFIRMED_DUPLICATE` — asserted by tests in both the unit and e2e suites.

| Action | Effect |
| --- | --- |
| **Same issue** | Pair → `CONFIRMED_DUPLICATE`; the newer problem gets `duplicateOfId` and status `DUPLICATE`; an `AuditLog` entry records who decided and the score at that moment |
| **Different issue** | Pair → `NOT_DUPLICATE`, kept as a labelled negative, withdrawn from the UI |

Restricted to the **reporter and platform admins**: marking someone's report a
duplicate is a judgement about their submission, not a community action.

Neither report is ever deleted. The newer one is evidence the problem is still
there, and the number of people who hit it matters. Transferring supporters and
comments onto the canonical report is a *merge*, and is a later milestone.

---

## 15. Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DUPLICATE_GEO_RADIUS_METERS` | `750` | Distance at which geographic similarity is 0.5 |
| `DUPLICATE_MAX_DISTANCE_METERS` | `5000` | Hard retrieval cut-off |
| `DUPLICATE_GEO_GATE_FLOOR` | `0.25` | Below this, distance suppresses the score |
| `DUPLICATE_CATEGORY_GATE_FLOOR` | `0.4` | Below this, category suppresses the score |
| `DUPLICATE_CANDIDATE_LIMIT` | `20` | Neighbours retrieved before scoring |
| `DUPLICATE_RESULT_LIMIT` | `5` | Candidates stored and shown |
| `DUPLICATE_MIN_TEXT_SIMILARITY` | `0.35` | Pre-filter before scoring |
| `DUPLICATE_WEIGHT_TEXT` | `0.35` | |
| `DUPLICATE_WEIGHT_IMAGE` | `0.25` | |
| `DUPLICATE_WEIGHT_GEO` | `0.25` | |
| `DUPLICATE_WEIGHT_CATEGORY` | `0.10` | |
| `DUPLICATE_WEIGHT_TEMPORAL` | `0.05` | |
| `DUPLICATE_HIGH_THRESHOLD` | `0.85` | Likely duplicate |
| `DUPLICATE_POSSIBLE_THRESHOLD` | `0.65` | Possible duplicate |
| `DUPLICATE_RELATED_THRESHOLD` | `0.50` | Related; below this, discarded |
| `DUPLICATE_TEMPORAL_HALF_LIFE_DAYS` | `120` | |
| `DUPLICATE_TEMPORAL_FLOOR` | `0.35` | Oldest possible temporal score |

---

## 16. Evaluation

**Not yet measured.** There is no labelled set, and quoting a precision figure
computed against invented labels would be worse than quoting none.

### The metrics that will matter

| Metric | Why |
| --- | --- |
| **Precision** | The cost of a false positive is a citizen wrongly told their report already exists — possibly discouraging a legitimate report. This is the metric to optimise. |
| **Recall** | The cost of a false negative is a duplicate in the queue. Recoverable later; less damaging. |
| **F1** | Summary, reported but not optimised directly. |
| **PR-AUC** | Preferred over ROC-AUC: duplicate pairs are a tiny fraction of all pairs, and ROC-AUC flatters a classifier badly under that imbalance. |
| **Precision@1** | The UI leads with one candidate, so the top-ranked result carries most of the product weight. |
| **Latency** | p50/p95 of the whole check, and the candidate count per check. |

### Building the labelled set

1. **Review decisions** from §14 — the natural source, already accruing.
2. **Retrospective labelling** of historical pairs by a reviewer, to bootstrap.
3. **Hard negatives** matter most: same category, same neighbourhood, genuinely
   different problems. Random negatives are trivially separable and will make any
   classifier look better than it is.

### Threshold selection

Thresholds should be set from a precision-recall curve on a held-out set, at a
chosen operating precision — currently they are informed guesses, and §15 exists
so that changing them is configuration rather than a deploy.

---

## 17. Observability

Logged per check: start, problem reference, candidates compared, candidates
stored, likely-duplicate count, model name, duration. On failure: the structured
error code and whether it was retryable.

Never logged: vectors, API keys, canonical text, or any reporter detail.

`rawResult` on the check's job row records `{provider, comparedCount, keptCount,
likelyCount}` — counts and provenance, never vectors.

---

## 18. Security

| Concern | Handling |
| --- | --- |
| Raw vectors exposed | Never serialised; not even loaded by the read path. Asserted by an e2e test. |
| Client-supplied scores | Rejected outright — the global validation pipe runs `forbidNonWhitelisted`, so a body carrying `combinedScore`, `confidence` or `duplicateOfId` is a 400. All scoring is server-side. |
| IDOR on review | A candidate id is always checked against the problem in the URL; a mismatch is a 404, identical to a missing pair, so the endpoint does not confirm which ids exist. |
| Unauthorised confirmation | Reporter or `ADMIN` only. Anonymous → 401, other citizen → 403, organisation → 403. |
| Unbounded AI work | Re-check is reporter/admin only and refuses while one is in flight (409). Retrieval is bounded by `LIMIT` and a radius. |
| SSRF | The embedding endpoint accepts text only. It fetches nothing. |
| Vector endpoint exposure | `POST /embeddings/text` requires the internal token and is unreachable from a browser. |
| Enumerating drafts | `/similar` resolves through the problem, so a `DRAFT` stays invisible to non-owners. |

---

## 19. Performance

The corpus today is small enough that PostgreSQL will choose a sequential scan
regardless of indexing; the design targets the scale it is for.

- **HNSW** on `problem_embeddings.embedding` with `vector_cosine_ops`, matching
  the normalised vectors the encoder produces. HNSW rather than IVFFlat because
  IVFFlat needs a training pass over existing rows and degrades until rebuilt,
  which suits a corpus growing continuously from empty badly.
- **GiST** on `problems.location` for the radius filter.
- One query per check. No N+1, no corpus in application memory, no all-pairs
  comparison.
- Retrieval bounded by `LIMIT 20`; persistence bounded by `RESULT_LIMIT 5`.

The known tension: an ANN `ORDER BY` combined with restrictive `WHERE` clauses
can over-filter. At present the PostGIS predicate narrows first and the vector
distance is computed exactly on a small set, which is *more* accurate. If the
planner's choice becomes a problem at scale, the fix is a two-stage query —
`ST_DWithin` into a CTE, then ANN within it.

---

## 20. Related documents

- [`ML_PLAN.md`](./ML_PLAN.md) — the full model roadmap
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how NestJS and FastAPI communicate
- [`DATABASE.md`](./DATABASE.md) — vector and duplicate schema
- [`API.md`](./API.md) — endpoint contracts
