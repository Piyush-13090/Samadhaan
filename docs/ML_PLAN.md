# ML Plan

> **Nothing here is implemented.** `services/ai` currently exposes health
> endpoints and the infrastructure to build on: configuration, structured
> logging, internal-token auth, schema contracts and a service layer.
>
> There are no placeholder classifiers and no random scores anywhere in this
> repository. A fabricated AI response is worse than an absent one — it is
> indistinguishable from a broken real one, it invites UI to be built on a
> contract that was never validated, and in a civic accountability product it
> would mean fake severity scores attached to real public problems.

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

## 1. Multimodal problem understanding

Read a photo plus a description and produce structured attributes: what the
problem is, what is visible, the apparent scale, any safety concern.

**Approach.** A vision-capable LLM (Claude, GPT-4o class) with a strict
JSON-schema response. Images are downscaled before sending — cost scales with
resolution and civic photos are far larger than needed.

**Initially:** hosted API. **Later:** a fine-tuned open vision model, once there
is a corpus of Indian civic imagery with verified labels — the domain is narrow
enough for a small model to beat a general one, and per-report cost matters at
volume.

**Metric:** human agreement rate on a held-out sample.

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

## 4. Duplicate detection

Identify that a new report describes an already-reported problem.

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

## 5. Semantic embeddings

Vector representations of problem text for duplicate detection, semantic search
and RAG retrieval.

**Approach.** Hosted embedding API initially; `sentence-transformers`
(multilingual, for Indian-language reports) self-hosted later, when per-embedding
cost or data residency justifies it.

Stored as `vector(N)` in PostgreSQL with an HNSW index. `EMBEDDING_DIMENSIONS`
must match the column dimension — **changing the model requires a migration and
a full re-embed**, so the model and dimension are recorded per row.

---

## 6. Image similarity

Detect that two photos show the same physical object, including from different
angles and lighting.

**Approach.** CLIP or a similar vision encoder producing an image embedding per
photo, stored in pgvector. Compared only within the geographic candidate set.

**Known limit.** Two potholes on the same street look alike. Image similarity is
a *supporting* signal for duplicate detection, never a sole basis for merging.

---

## 7. Geographic similarity

Decide whether two locations refer to the same physical problem.

**Approach.** PostGIS `ST_DWithin` on `geography(Point, 4326)` with a GiST
index. The radius is category-dependent — two streetlight reports 50 m apart are
different lights; two lake-pollution reports 200 m apart are the same lake. So
the threshold is a per-category parameter, not a constant.

GPS accuracy varies from metres to hundreds of metres, so reported accuracy is
stored and factored into the threshold.

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
| 1. Multimodal understanding | Hosted vision LLM | Fine-tuned open vision model |
| 2. Classification | Derived from (1) | Fine-tuned text classifier |
| 3. Severity | LLM + published rubric | Learned, calibrated model |
| 4. Duplicate detection | Geo + vector cascade | Learned combiner over signals |
| 5. Embeddings | Hosted API | Self-hosted sentence-transformers |
| 6. Image similarity | CLIP-class encoder | Domain fine-tuned encoder |
| 7. Geographic similarity | PostGIS, per-category radius | Learned radius from merge history |
| 8. Priority | Transparent rules | Learned ranker + fairness monitoring |
| 9. Org recommendation | Ranked retrieval | Learned from allocation outcomes |
| 10. RAG | pgvector hybrid search | Same, tuned retrieval |
| 11. AI Coordinator | LLM structured extraction | Same, domain-tuned prompts |
| 12. Verification | Vision LLM + metadata checks | Domain-trained verifier |

## Infrastructure that exists today

| Piece | Where |
| --- | --- |
| Service skeleton, routing, lifespan | `services/ai/app/main.py` |
| Settings incl. LLM/embedding placeholders | `services/ai/app/core/config.py` |
| Structured logging with correlation ids | `services/ai/app/core/logging.py` |
| Internal-token auth for non-public routes | `services/ai/app/core/security.py` |
| Model wrapper location | `services/ai/app/models/` (empty by design) |
| Typed client from NestJS | `apps/api/src/ai/ai.client.ts` |
| Application-facing AI entry point | `apps/api/src/ai/ai.service.ts` |

Adding a capability means: a Pydantic schema in `app/schemas/`, logic in
`app/services/`, a router in `app/api/routes/`, and a typed method on
`AiService` in NestJS. No structural change required.
