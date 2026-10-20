# ML Capability Inventory (Prompt 28)

What each AI capability in Samadhaan actually is today, read from the code:
whether it's a hosted model, a pretrained local model, a heuristic or a trained
model; what labelled data exists; and whether training it now would be
justified.

**There are no locally trained models in production.** Prompt 28 added the
pipeline, evaluation, registry and lifecycle a trained model would need. It did
not train a production model, because no human-reviewed labelled dataset
exists yet (see the data audit below).

## Kinds of implementation

| Kind | Meaning here |
| --- | --- |
| **Hosted model** | A third-party model called over an API (Anthropic Claude, `LLM_PROVIDER=anthropic`). |
| **Pretrained local model** | Downloaded weights run inside the AI service, unchanged (`sentence-transformers/all-MiniLM-L6-v2`). |
| **Heuristic** | Hand-set rules, weights and thresholds in code or config. They aren't learned from data. |
| **Trained model** | Fitted on Samadhaan's labelled data by `python -m ml train` and served from the registry. **None is active.** |
| **Development stub** | `LLM_PROVIDER=development`: deterministic keyword output, labelled `development-keyword-stub`, refused in production. |

## Inventory

| Capability | Implementation today | Kind | Training data | Evaluation data | Train now? | Human oversight |
| --- | --- | --- | --- | --- | --- | --- |
| Problem category / subcategory | Claude vision analysis, structured output, taxonomy normalisation (`services/ai/app/services/analysis_service.py`) | Hosted model | None reviewed. The category on a problem is **citizen-selected** at submission; the AI's category is AI output. Neither is an independent label, and there's no official re-categorisation workflow. | None | **No.** Pipeline ready (`problem_category`); needs a reviewed dataset. | Advisory. The problem's category is never changed by AI (`problem-analysis.service.ts`). |
| Severity / urgency | Same Claude call, against a published rubric (`app/core/taxonomy.py`) | Hosted model | None. Severity/urgency labels are AI output. | None | **No.** Pipeline ready (`problem_severity`, `problem_urgency`, ordinal metrics, time split). | Advisory. Government review decides. |
| Text embeddings | `all-MiniLM-L6-v2`, 384-d, local (`sentence_transformer_provider.py`) | Pretrained local model | n/a (not fine-tuned) | Indirect only (duplicate, search, RAG evaluation) | **No.** Fine-tuning needs labelled civic text pairs. | n/a |
| Image embeddings | **Not implemented.** No image-embedding model exists. Duplicate and verification image signals are absent or perceptual-hash only. | — | — | — | — | — |
| Duplicate detection | PostGIS radius + embedding similarity + category, gated and weighted; thresholds 0.85 / 0.65 / 0.50 (`duplicate-scoring.service.ts`) | Heuristic over pretrained embeddings | Human decisions are stored (`CONFIRMED_DUPLICATE` / `NOT_DUPLICATE` with reviewer). Dev DB: **0 reviewed pairs**. Exporter: `apps/api/scripts/ml/export-duplicate-labels.sh`. | Same source, once it accumulates | **Not yet.** Pipeline ready (`duplicate_pair`: grouped splits, PR curve, precision-first threshold). | Only a person can confirm a duplicate; the detector's ceiling is `LIKELY_DUPLICATE`. |
| Organisation matching | `heuristic-baseline@1.0.0`: weighted semantic 0.35, expertise 0.30, category 0.15, geography 0.10, capability 0.05, activity 0.05 (`services/ai/app/matching/`) | Heuristic over pretrained embeddings | None. Dismissals and allocations reflect capacity and policy, not judged relevance. | Hand-written dev set: 6 problems × 8 organisations (`evaluation/organization_matching_dev.json`) | **No.** Evaluation-only schema (`organization_relevance`) with P@K, R@K, MRR, NDCG and exposure by organisation size. | Recommendations only; officials allocate. |
| Civic priority | `priority-heuristic-v1`: eight features, confidence-weighted, community-share cap, safety floor (`apps/api/src/priority/priority-model.ts`); some features from an LLM | Heuristic (+ hosted model features) | None. Overrides exist (`problem_priority_overrides`) but are partial and biased toward disagreement. Dev DB: 0. | None independent | **No.** Sensitivity analysis instead (`scripts/ml/priority-sensitivity.mjs`); expert-adjudicated schema (`priority_judgement`) for later. | Advisory; officials override with an audited reason. |
| Resolution evidence verification | Vision LLM review + deterministic location/time/completeness/quality checks + perceptual hash + guard rules (`verification_service.py`, `apps/api/src/verification/`) | Hosted model + heuristics | Government decisions stored (`resolution_verification_requests`). Dev DB: **0 decided**. | Same, once it accumulates | **No.** Evaluation schema (`verification_outcome`) reports the false-resolution rate and the insufficient-evidence class separately. | A government decision is always required; AI never marks anything resolved. |
| Semantic search ranking | Hybrid keyword + semantic, fixed weights (`docs/SEARCH_RANKING.md`) | Heuristic over pretrained embeddings | None. No relevance judgements are recorded. | None | **No.** Evaluation schema (`retrieval_judgement`: recall@K, MRR, NDCG). | n/a (results are access-filtered) |
| RAG retrieval | Hybrid retrieval, weights 0.60/0.15/0.10/0.10/0.05, MMR (`docs/RAG_ARCHITECTURE.md`) | Heuristic over pretrained embeddings | None | None (`knowledge_answers`: 0 in dev DB) | **No.** Same `retrieval_judgement` schema. | Answers cite sources and have an insufficient-evidence path. |
| Search query understanding, AI coordinator, analytics insights | Rules first, then hosted LLM with constrained output | Hosted model + rules | n/a | n/a | Not in scope for training | Outputs are validated and labelled as AI. |

## Data audit (2026-10-18, development database)

Counted directly in the development database, not estimated. A production
database may hold more, and must be counted the same way before any training
decision.

| Source | Rows | Human-reviewed |
| --- | --- | --- |
| Problems | 12 | — |
| Duplicate candidates | 9 (4 PENDING, 5 LIKELY_DUPLICATE) | **0** |
| Organisation matches | 19 (CALCULATED) | 0 judged |
| Priority overrides | 0 | 0 |
| Verification decisions | 0 | 0 |
| AI analyses | 235 | 0. They are AI outputs, not labels. |
| Knowledge answers | 0 | — |

## What would make training appropriate

A task becomes trainable when:

1. a dataset of **independent human judgements** exists, with provenance
   (`docs/ML_DATASETS.md`);
2. it passes validation and the split minimums (by default at least 30 test
   records, 3 per class in test and 5 per class in training; production configs
   ask for far more);
3. the existing system has been evaluated on the same held-out split
   (`python -m ml evaluate --split test`);
4. a trained model beats that baseline by a margin that matters, without
   regressing on rare severe classes or on any reported group.

Until then the hosted model and heuristics stay primary, and the registry stays
empty.
