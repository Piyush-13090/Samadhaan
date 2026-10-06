# Knowledge & RAG — architecture

Retrieval-augmented answers over civic guidelines, policies and project
documents (Prompt 20). A person asks a question; Samadhaan retrieves passages
**they are allowed to read**, and a model answers **only from those passages**,
citing each claim. When the passages do not cover the question, it says so.

> **RAG provides evidence, not authority.** An answer is a summary of cited
> passages. It never verifies, allocates, approves, creates tasks or changes
> any project, problem or allocation.

Companions: [`KNOWLEDGE_MODEL.md`](./KNOWLEDGE_MODEL.md) (tables, scopes,
lifecycle) and [`RAG_SECURITY.md`](./RAG_SECURITY.md) (access control,
prompt injection, logging, caching).

---

## 1. Shape

```
Next.js ──▶ NestJS ───────────────────────────────────────────▶ FastAPI ───────────▶ models
            │ KnowledgeAccessService (who may read what)          │ /knowledge/chunk     extraction + chunking
            │ KnowledgeIngestionService (background queue)        │ /embeddings/text     sentence-transformers
            │ KnowledgeRetrievalService (one SQL statement)       │ /knowledge/answer    LLM (evidence-only prompt)
            │ KnowledgeContextBuilder (bounded app context)       │ no database access
            │ KnowledgeQueryService (orchestration, records)      │
            ▼
         PostgreSQL + pgvector: knowledge_sources · knowledge_documents · knowledge_chunks · knowledge_answers
```

- **NestJS owns** authorisation, storage, the ingestion queue, retrieval SQL,
  scoring, the application context, persistence and citations.
- **Python owns** text extraction, chunking, embeddings, the prompt and the
  model call, plus a first citation check. Python never touches the database.
  NestJS checks the citations again.
- The embedding model is the same one problems use: `all-MiniLM-L6-v2`, 384
  dimensions, normalised. It is called through `AiService.embedText`, and no
  embeddings are generated anywhere else.

## 2. Ingestion

```
create / upload / re-index ─▶ PENDING ─▶ PROCESSING
   ─▶ /knowledge/chunk : detect type from bytes · extract (PDF via pypdf, HTML visible text, UTF-8 text)
                         · clean · heading- and paragraph-aware chunks with overlap
   ─▶ reuse vectors for chunks whose content hash is unchanged (same source, same model)
   ─▶ /embeddings/text for the rest, 64 per batch
   ─▶ one transaction: replace the source's document and chunks
   ─▶ COMPLETED (chunk count, embedding model/version, chunker version)
      or FAILED (a fixed, safe message — never a stack trace or provider detail)
```

- **Background.** `POST /knowledge/sources`, `…/file` and `…/ingest` return
  at once (`201`/`202`). An in-process queue indexes one source at a time.
  On startup, sources left PENDING or PROCESSING are queued again; this is
  how seeded sources get indexed.
- **Chunking** (`paragraph-v1`, Python `app/knowledge/chunking.py`):
  - Markdown, numbered and ALL-CAPS headings start a new section. The section
    title travels with each chunk.
  - Paragraphs are packed up to `RAG_CHUNK_MAX_TOKENS` (350; tokens are
    estimated as words × 1.3).
  - An oversized paragraph is split at sentence boundaries.
  - `RAG_CHUNK_OVERLAP_TOKENS` (50) of trailing text opens the next chunk,
    but only within the same section.
  - Fragments under 20 tokens merge forward.
  - Each chunk carries a SHA-256 `contentHash`, its PDF `pageNumber` and its
    `tokenCount`.
- **Limits:**
  - Uploads are at most 10 MB, as PDF, plain text, Markdown or HTML. The type
    is checked from the bytes and the extension.
  - Pasted text is at most 500,000 characters.
  - A source yields at most `RAG_MAX_CHUNKS_PER_SOURCE` chunks (2000).
  - Encrypted PDFs and PDFs over the page limit are refused.
- **External URLs are references only.** They are never fetched.

## 3. Retrieval

One SQL statement, inside a transaction that sets `hnsw.ef_search = 100` and
`hnsw.iterative_scan = relaxed_order`. Iterative scans keep a filtered HNSW
search returning rows until its LIMIT is met.

```sql
WITH q   AS (query vector, OR-ed tsquery, query terms),
     vec AS (top RAG_CANDIDATES by cosine distance   WHERE status = COMPLETED AND same model AND <access predicate>),
     kw  AS (top RAG_CANDIDATES/2 by ts_rank_cd      WHERE … AND <access predicate> AND content @@ tsquery)
SELECT … semantic = 1 − distance, keyword = share of query terms present …
FROM (vec ∪ kw) JOIN chunks JOIN sources WHERE <access predicate>
```

- **Authorisation is in the WHERE clause**, applied in each candidate set and
  again in the final join. Nothing outside the caller's scope is read. See
  `RAG_SECURITY.md` §1.
- **Indexes:** HNSW `knowledge_chunks_embedding_hnsw` (`vector_cosine_ops`)
  and GIN `knowledge_chunks_content_fts` on `to_tsvector('english', content)`.
  Chunks are never loaded into Node to compute similarity.
- **The query embedding** is cached in Redis under `rag:qemb:v1:{sha256(text)}`
  for `RAG_QUERY_CACHE_SECONDS`. Results and answers are never cached.
- **Contextual query.** In a PROBLEM or PROJECT context, the embedded text is
  the question plus a short hint (category, title, open tasks). Keyword
  matching uses the question alone.

### Hybrid score (`hybrid-baseline-v1`, `src/knowledge/scoring.ts`)

| Signal | Weight (env) | Value in [0, 1] |
| --- | --- | --- |
| semantic | 0.60 `RAG_WEIGHT_SEMANTIC` | cosine similarity (pgvector) |
| keyword | 0.15 `RAG_WEIGHT_KEYWORD` | share of the question's (stemmed) terms the passage contains |
| source | 0.10 `RAG_WEIGHT_SOURCE` | civic guideline or policy 1; project docs 1 in a project context, otherwise 0.6; organisation document or problem context 0.7; web reference 0.5; other 0.4 |
| context | 0.10 `RAG_WEIGHT_CONTEXT` | category match 1, uncategorised 0.5, mismatch 0.1; city +0.2 on a match, ×0.5 on a mismatch; 0.5 with no context |
| recency | 0.05 `RAG_WEIGHT_RECENCY` | exponential decay on the source's last update, 1-year half-life |

Weights are normalised to sum to 1. **They are a documented baseline, not
learned values.**

- **Threshold.** A passage survives only if its semantic similarity is at
  least `RAG_SIMILARITY_THRESHOLD` (0.25), or it contains at least half the
  question's terms. Source, context and recency can re-order relevant
  passages but never make an irrelevant one relevant.
- **Diversity.** When `RAG_RERANK_ENABLED`, MMR (λ = 0.75) over the top
  `RAG_RERANK_TOP_K` (15) stops near-duplicate passages from one document
  filling every slot. This is a re-ordering, not a trained re-ranker.
- **Top-K.** `RAG_TOP_K` (6) passages reach the model.
- **Weak retrieval.** If the best semantic similarity is below
  `RAG_WEAK_SEMANTIC` (0.35), the answer carries `weakRetrieval: true` and
  the UI warns the reader.

## 4. Answering

```
POST /knowledge/query ─▶ validate context (problem visible? project participant?) ─▶ scope
   ─▶ retrieve ─▶ none?  ─▶ "The knowledge base does not contain enough information…"  (no model call)
               ─▶ E1…En evidence (≤ RAG_MAX_PASSAGE_CHARS each) + bounded app context
   ─▶ /knowledge/answer ─▶ citations checked in Python, then again in NestJS
   ─▶ knowledge_answers row (versions, chunk ids, scores, timings) ─▶ answer + citations
```

- **Prompt.** `knowledge-answer-2026-10-v1`, in
  `services/ai/app/prompts/knowledge_answer.py`. It separates SYSTEM, USER
  (`<question>`), EVIDENCE (`<evidence ref="E1">…`) and APP CONTEXT
  (`<context>`), and states that evidence is data, not instructions.
- **Output** is constrained to `{ answer, insufficient_evidence,
  evidence_refs, suggestions }`. Suggestions are the model's own and are
  shown apart from the answer, labelled "not stated by the sources".
- **Citations are validated twice.** Python strips `[E#]` markers for
  passages that were not provided. NestJS does the same again. An answer
  that cites nothing is marked insufficient. Every citation in the response
  maps to a real chunk id and links to `/knowledge/sources/{sourceId}#chunk-{chunkId}`.
- **Failure is honest:**
  - Retrieval or the model being unavailable returns `503`, and a FAILED
    record is kept.
  - With `LLM_PROVIDER=development` no model runs. The "answer" only quotes
    the retrieved passages and says so.
- **Retrieve-only mode.** `mode: "retrieve"` returns the scored passages
  without generating an answer.

### Application context (`KnowledgeContextBuilder`)

Short, already-authorised fact lines, under strict limits:

- a problem description of at most 600 characters;
- at most 10 open tasks, 5 milestones and 3 recent updates;
- at most 240 characters per line.

A **problem** context is built through the public problem rules
(`ProblemsService.findByPublicId`). A **project** context requires proven
participation.

The builder never includes:

- government internal notes;
- allocation reasons;
- room messages;
- contact details.

## 5. AI Project Coordinator integration

When the coordinator refreshes a project's insights:

1. It retrieves up to `RAG_COORDINATOR_TOP_K` (3) passages, from **PUBLIC
   sources and that project's PROJECT sources only**. GOVERNMENT, ORGANIZATION
   and PRIVATE sources are excluded, whoever triggered the refresh.
2. The passages go to the model in a "REFERENCE KNOWLEDGE (untrusted
   reference material)" section, with `knowledge:{chunkId}` refs
   (`coordinator-2026-10-v2`).
3. A finding may cite a passage, and the UI labels it "Guidance".
4. Retrieval failure never blocks the coordinator.

## 6. Reproducibility

Each `knowledge_answers` row records:

- **Models:** `modelName`, `modelVersion`, `embeddingModel`, `embeddingVersion`.
- **Versions:** `retrievalVersion`, `promptVersion`.
- **Retrieval:** `retrievedChunkIds` and per-passage `scores` (all five
  signals).
- **Timings:** `retrievalMs`, `generationMs` and the timestamp.

The question is stored for evaluation, but the answer row holds no passage
text.

## 7. Configuration

All `RAG_*` variables are listed in `.env.example`. `RAG_ENABLED=false` turns
off querying; the coordinator then runs without knowledge.

## 8. Not built (by design, for now)

- Learned re-ranking.
- Feedback-driven evaluation.
- Fetching external URLs.
- OCR for scanned PDFs.
- Multilingual embeddings.
- Per-tenant embedding models.
- Autonomous agents, or any automatic decision.
