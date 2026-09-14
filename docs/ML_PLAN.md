# ML Plan

> **Systems 1, 4, 5 and 7 are implemented** — multimodal problem understanding,
> duplicate detection, text embeddings and geographic similarity. Everything else
> on this page is still a plan. Each section is marked.
>
> Duplicate detection has its own detailed document:
> [`ML_DUPLICATE_DETECTION.md`](./ML_DUPLICATE_DETECTION.md).
>
> There are no placeholder classifiers and no random scores anywhere in this
> repository. A fabricated AI response is worse than an absent one — it is
> indistinguishable from a broken real one, it invites UI to be built on a
> contract that was never validated, and in a civic accountability product it
> would mean fake severity scores attached to real public problems.
>
> The one stub that exists — `development_provider.py` — is refused in
> production by the provider factory, labels itself `development-keyword-stub`
> in `modelName`, reports a deliberately low confidence, and the UI prints a
> warning whenever it produced a result.

## Principles

1. **AI recommends; humans decide.** Allocation and closure are human decisions.
   Every AI output is stored with its confidence and the model version that
   produced it.
2. **Buy first, build later.** Start with hosted models. Replace a component
   with a custom model only when there is labelled data from real usage and a
   measured reason.
3. **Store inputs and outputs.** Every inference records its input reference,
   output, confidence and model version — this is the training set for any later
   custom model, and the audit trail when a score is disputed.
4. **Degrade, never block.** A problem must be reportable when the AI service is
   down. Analysis is asynchronous; the report is saved first and enriched after.
5. **Measure before optimising.** Each system below needs an offline metric and
   a decision threshold before it ships.

---

## 1. Multimodal problem understanding — **implemented**

Read a photo plus a description and produce structured attributes: category,
subcategory, severity, urgency, confidence, a citizen-readable summary, and
evidence-based observations.

**What shipped.** Claude vision via the Anthropic SDK, with constrained
structured output (`messages.parse` against a Pydantic schema) rather than
JSON-mode-and-hope. Images are downscaled to 1024px JPEG before sending — cost
scales with resolution and civic photos are far larger than needed. The stored
original is never touched.

| Piece | Where |
| --- | --- |
| System prompt | `services/ai/app/prompts/problem_analysis.py` |
| Provider interface | `services/ai/app/providers/base.py` |
| Claude provider | `services/ai/app/providers/anthropic_provider.py` |
| Development stub | `services/ai/app/providers/development_provider.py` |
| Taxonomy normalisation | `services/ai/app/core/taxonomy.py` |
| Orchestration | `services/ai/app/services/analysis_service.py` |
| Lifecycle in NestJS | `apps/api/src/problems/services/problem-analysis.service.ts` |

**What the prompt enforces.** Use both image and text; on conflict prefer the
more cautious reading; never invent detail or locations; never identify people;
observations are evidence, not reasoning. Private chain-of-thought is neither
requested nor stored — only the observations, which are written for the citizen
who filed the report.

**Calibration rules that are code, not prompting.** A text-only analysis is
capped at 0.75 confidence, because a model reasoning from a description alone
cannot be as certain as one that saw the problem. A category outside the
taxonomy becomes `OTHER`. A confidence returned as a percentage is rescaled,
not clamped.

**Still hosted.** **Later:** a fine-tuned open vision model, once there is a
corpus of Indian civic imagery with verified labels — the domain is narrow
enough for a small model to beat a general one, and per-report cost matters at
volume. Every inference is already stored with its model name, version and
confidence, which is that training set accumulating.

**Metric:** human agreement rate on a held-out sample. Not yet measured — there
is no labelled sample of real reports yet.

---

## 2. Problem classification

Assign a category (road, water, sanitation, electricity, safety, environment,
public infrastructure) and sub-category.

**Approach.** Derived from the analysis in (1) rather than a separate model call
— one multimodal call produces category, severity and attributes together, which
is cheaper and keeps them consistent. A fine-tuned text classifier over
description plus extracted attributes becomes worthwhile once labelled volume
exists.

**Handling low confidence.** Below threshold, the problem is marked
`needs_review` rather than being assigned a wrong category. A misfiled problem
reaches the wrong department and stalls.

**Metric:** macro-F1 across categories — accuracy hides failure on rare
categories, which are often the urgent ones.

---

## 3. Severity estimation

Score severity and urgency (1–5).

**Approach.** Initially LLM-assessed from image and description against an
explicit published rubric, so a score can be argued with rather than merely
trusted. Signals: safety risk, people affected, infrastructure criticality,
apparent degradation.

**Later:** a learned model over multimodal features plus community signal
(supporter count, velocity) plus historical government response. Notably, actual
government prioritisation is a label — what gets fixed first reveals real
institutional severity, which is not the same as the rubric.

**Calibration matters more than accuracy.** A severity 4 should be genuinely
worse than a 3. Reported with a confidence interval, not a bare number.

---

## 4. Duplicate detection — **implemented**

Identify that a new report describes an already-reported problem.

Full design, evaluation plan and configuration:
[`ML_DUPLICATE_DETECTION.md`](./ML_DUPLICATE_DETECTION.md).

**What shipped.** The cascade below, as one SQL query into a pure scoring
function, with two additions the original plan did not anticipate:

- **Gates, not just weights.** Geography and category are necessary conditions,
  not votes. A plain weighted combination scores identical text 500 km apart at
  0.66 — a "possible duplicate" — because text outvotes a near-zero geographic
  signal.
- **Renormalisation over available signals.** Image similarity does not exist
  yet, so its weight is redistributed rather than scored as zero. A missing
  signal shows up as lower `confidence`; it never drags the score down as though
  the photos had been compared and found different.

**Approach.** A cascade, cheapest filter first:

1. **Geographic** — PostGIS radius query. A duplicate is almost always within a
   few hundred metres. This eliminates nearly all candidates before any vector
   work.
2. **Semantic** — pgvector cosine similarity on text embeddings, within the geo
   candidate set.
3. **Visual** — image embedding similarity, for candidates passing (2).
4. **Decision** — a weighted score over the three signals. Above the high
   threshold, auto-merge; between thresholds, surface as "possible duplicate"
   for human confirmation; below, treat as new.

**Why a cascade.** Vector search across every problem for every report is
wasteful when geography eliminates 99% of candidates for free.

**Recording rejections matters.** Every candidate pair is stored with its score
and the human decision — including rejections. Without them the thresholds
cannot be tuned.

**Metric:** precision at the auto-merge threshold must be very high. A wrongly
merged report silently erases a citizen's distinct problem, which is far worse
than a duplicate surviving.

---

## 5. Semantic embeddings — **implemented**

Vector representations of problem text for duplicate detection, semantic search
and RAG retrieval.

**What shipped.** `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions,
L2-normalised) running **locally inside the AI service**, not through a hosted
API — the reverse of the order this plan originally proposed.

The reason for the reversal: deduplication runs on every submitted report, so a
per-call price makes the cost of the feature scale with civic participation,
which is exactly the wrong incentive for a platform whose goal is more reporting.
A 22M-parameter encoder is adequate for short descriptive text, and it works
offline and in CI with no key.

Stored as `vector(384)` with an HNSW index. `EMBEDDING_DIMENSIONS` must match
both the model and the column — **changing the model requires a migration and a
full re-embed** — so model name, version and width are recorded on every row and
retrieval filters on the model.

**Later:** a multilingual encoder for Indian-language reports
(`paraphrase-multilingual-MiniLM-L12-v2` is the same width, so that swap is a
re-embed with no migration), then a domain fine-tune once there is a corpus of
labelled civic text.

---

## 6. Image similarity

Detect that two photos show the same physical object, including from different
angles and lighting.

**Approach.** CLIP or a similar vision encoder producing an image embedding per
photo, stored in pgvector. Compared only within the geographic candidate set.

**Known limit.** Two potholes on the same street look alike. Image similarity is
a *supporting* signal for duplicate detection, never a sole basis for merging.

---

## 7. Geographic similarity — **implemented**

Decide whether two locations refer to the same physical problem.

**What shipped.** PostGIS `ST_DWithin` and `ST_Distance` on
`geography(Point, 4326)` with a GiST index, converted to a similarity by
half-value decay at a configured radius (750 m default), plus a **proximity
gate** that suppresses the combined score when two reports are not plausibly
co-located. See [`ML_DUPLICATE_DETECTION.md`](./ML_DUPLICATE_DETECTION.md) §7.

**Deferred, deliberately:** the radius is currently a single constant, not a
per-category parameter. Two streetlight reports 50 m apart are different lights;
two lake-pollution reports 200 m apart are the same lake — so a per-category
radius is clearly right, but choosing twelve of them by hand would be twelve more
invented numbers. It is better learned from confirmed merges, which the review
flow is now accumulating.

Reported GPS accuracy is stored on every problem (`locationAccuracyM`) and is not
yet factored into the threshold — the same argument applies.

---

## 8. Priority prediction

Order the government triage queue.

**Approach.** Severity and urgency, plus community signal (supporters, velocity),
plus category-specific escalation rules, plus age. Explicitly rule-based and
transparent at first: a public body must be able to explain why one problem
outranked another, and an unexplainable ranking will not be trusted or used.

**Later:** a learned ranker trained on actual resolution outcomes — but always
alongside the human-readable factors, not replacing them.

**Fairness is a first-class concern.** If a model learns to prioritise
wealthier, more vocal areas because those historically got faster resolution, it
will encode that inequity. Priority distribution must be monitored by area, and
community signal must not dominate — that is precisely the channel through which
the bias enters.

---

## 9. Organisation recommendation

Match a problem to organisations able to resolve it.

**Approach.** Ranked retrieval over capability tags, service area (PostGIS
containment), past resolution record in the category, and current capacity. A
recommendation, surfaced to both the organisation's discovery feed and the
government allocator — never an automatic assignment.

**Cold start:** a new organisation has no record, so capability and geography
carry the weight until it builds one.

---

## 10. RAG

Ground answers about civic procedures, similar past resolutions and applicable
regulations in retrieved documents.

**Approach.** A document store of municipal procedures, resolved-problem
histories and relevant regulation; chunked, embedded into pgvector, retrieved by
hybrid search (vector plus `pg_trgm` keyword), and passed to an LLM with a
strict instruction to answer only from the retrieved context.

**Answers cite their sources.** In a civic context an uncited answer is unusable
— an official needs to see the regulation, not be told about it.

Uses the same PostgreSQL + pgvector instance; a dedicated vector database is not
warranted at this scale.

---

## 11. AI Project Coordinator

Keep resolution rooms moving: request progress on schedule, and convert free-text
replies into structured milestone updates.

**Approach.** A scheduled job (Redis-backed queue) prompts for updates based on
milestone dates and silence. Replies go through LLM structured extraction —
percentage complete, blockers, revised dates — stored **alongside** the original
text, never replacing it. The organisation confirms the extraction; it is a
draft, not a fact.

This is the clearest case of AI reducing coordination overhead rather than making
decisions.

---

## 12. Resolution verification

Assist a government reviewer in deciding whether submitted evidence shows the
problem is actually resolved.

**Approach.** Compare completion evidence against the original report:

- **Location** — does evidence EXIF/geotag match the reported location?
- **Subject** — image similarity between before and after photos: same place?
- **Resolution** — does the "after" image show the problem absent?
- **Plausibility** — is the timeline consistent with the work claimed?

Output is a **findings list with confidence**, not a verdict. A human approves
closure.

**Adversarial by nature.** Unlike every other system here, this one has a party
with an incentive to deceive it — an organisation wanting a problem marked
resolved. So: evidence metadata is validated, not trusted; a high AI confidence
never auto-closes; and a sample of closures is audited regardless of score.

---

## Model stack summary

| System | Initially | Later |
| --- | --- | --- |
| 1. Multimodal understanding ✅ | Hosted vision LLM (Claude) | Fine-tuned open vision model |
| 2. Classification | Derived from (1) | Fine-tuned text classifier |
| 3. Severity | LLM + published rubric | Learned, calibrated model |
| 4. Duplicate detection ✅ | Geo + vector cascade, gated | Learned combiner over signals |
| 5. Embeddings ✅ | Self-hosted sentence-transformers | Domain fine-tuned encoder |
| 6. Image similarity | CLIP-class encoder | Domain fine-tuned encoder |
| 7. Geographic similarity ✅ | PostGIS, single radius + gate | Per-category radius learned from merge history |
| 8. Priority | Transparent rules | Learned ranker + fairness monitoring |
| 9. Org recommendation | Ranked retrieval | Learned from allocation outcomes |
| 10. RAG | pgvector hybrid search | Same, tuned retrieval |
| 11. AI Coordinator | LLM structured extraction | Same, domain-tuned prompts |
| 12. Verification | Vision LLM + metadata checks | Domain-trained verifier |

## Infrastructure that exists today

| Piece | Where |
| --- | --- |
| Service skeleton, routing, lifespan | `services/ai/app/main.py` |
| Settings incl. LLM/embedding configuration | `services/ai/app/core/config.py` |
| Structured logging with correlation ids | `services/ai/app/core/logging.py` |
| Internal-token auth for non-public routes | `services/ai/app/core/security.py` |
| Vision-language provider interface | `services/ai/app/providers/base.py` |
| Provider factory with production guards | `services/ai/app/providers/factory.py` |
| Canonical taxonomy and normalisation | `services/ai/app/core/taxonomy.py` |
| Model wrapper location | `services/ai/app/models/` (empty by design) |
| Typed client from NestJS | `apps/api/src/ai/ai.client.ts` |
| Application-facing AI entry point | `apps/api/src/ai/ai.service.ts` |
| Analysis lifecycle and retry policy | `apps/api/src/problems/services/problem-analysis.service.ts` |
| Embedding provider interface | `services/ai/app/providers/embedding_base.py` |
| Local sentence-transformers encoder | `services/ai/app/providers/sentence_transformer_provider.py` |
| Duplicate pipeline | `apps/api/src/problems/services/duplicate-detection.service.ts` |
| Duplicate scoring (pure, configurable) | `apps/api/src/problems/services/duplicate-scoring.service.ts` |
| Stored inference records | `problem_ai_analyses`, `problem_embeddings`, `problem_duplicate_candidates` |

Adding a capability means: a Pydantic schema in `app/schemas/`, logic in
`app/services/`, a router in `app/api/routes/`, and a typed method on
`AiService` in NestJS. A capability that needs a different model adds a provider
under `app/providers/` behind the same interface. No structural change required.

Nothing in the analysis pipeline assumes one provider. Swapping Claude for
another vision model is one class implementing `VisionLanguageProvider` and one
line in the factory — the taxonomy normalisation, the calibration rules, the
retry policy and the whole NestJS side are provider-agnostic.
