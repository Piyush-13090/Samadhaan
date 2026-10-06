# Knowledge model

The data behind Knowledge & RAG (Prompt 20). Migration
`20261013090000_knowledge_rag`. Architecture:
[`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md). Security:
[`RAG_SECURITY.md`](./RAG_SECURITY.md).

---

## 1. Tables

| Table | Purpose | Notable constraints and indexes |
| --- | --- | --- |
| `knowledge_sources` | What was added and who may read it: `title`, `description`, `sourceType`, `visibility`, owning `organizationId` / `projectId`, `uploadedById`, `externalUrl` (reference only), file (`storageKey`, `fileName`, `mimeType`, `sizeBytes`) or `inlineText`, `categories ProblemCategory[]`, `city`; pipeline state `status`, `failureCode`, `failureMessage`, `attempts`, `chunkCount`, `embeddingModel`, `embeddingVersion`, `chunkerVersion`, `ingestedAt`; `metadata` | CHECK `knowledge_sources_scope_consistent` (below); `(visibility, status)`, `(organizationId, visibility)`, `(projectId)`, `(uploadedById)`, `(status, updatedAt)` |
| `knowledge_documents` | The extracted, cleaned text of one ingestion: `content`, `contentHash`, `pageCount`, `metadata` (detected type, characters) | Cascades from its source |
| `knowledge_chunks` | A retrievable passage: `chunkIndex`, `content`, `tokenCount`, `sectionTitle`, `pageNumber`, `contentHash`, `embedding vector(384)`, `embeddingModel`, `embeddingVersion`, `dimensions`; `sourceId` denormalised so the access predicate needs one join | UNIQUE `(documentId, chunkIndex)`; CHECK content length 1–8000; **HNSW** `knowledge_chunks_embedding_hnsw` (`vector_cosine_ops`); **GIN** `knowledge_chunks_content_fts` on `to_tsvector('english', content)`; `(sourceId)`, `(contentHash, embeddingModel)` |
| `knowledge_answers` | One row per question: asker, context (`contextType`, `problemId`, `projectId`), `question`, `answer`, `insufficientEvidence`, `status` (`ANSWERED`, `NO_EVIDENCE`, `FAILED`), `modelName`, `modelVersion`, `promptVersion`, `embeddingModel`, `embeddingVersion`, `retrievalVersion`, `retrievedChunkIds`, `scores`, `retrievalMs`, `generationMs`, `createdAt` | `(userId, createdAt)`, `(createdAt)` |

The HNSW and GIN indexes are also kept in `prisma/sql/post-migrate.sql`. Prisma
cannot describe them, and generated migrations would otherwise drop them.

**New enums:** `KnowledgeSourceType`, `KnowledgeVisibility` and
`KnowledgeIngestionStatus`.

## 2. Source types

`CIVIC_GUIDELINE`, `GOVERNMENT_POLICY`, `PROJECT_DOCUMENT`, `PROJECT_NOTE`,
`PROBLEM_CONTEXT`, `ORGANIZATION_DOCUMENT`, `WEB_REFERENCE`, `OTHER`.

The type affects ranking (`RAG_ARCHITECTURE.md` §3), never access.

## 3. Visibility — who can read it

| Visibility | Readable by | Who may publish | Database rule |
| --- | --- | --- | --- |
| `PUBLIC` | Every signed-in user | A platform admin, or an official for their own office (recorded as owner) | — |
| `GOVERNMENT` | Officials (role GOVERNMENT, active membership) of the owning office | Officials of that office | `organizationId` required |
| `ORGANIZATION` | Active members of the owning organisation | Its OWNER or ADMIN | `organizationId` required |
| `PROJECT` | Participants of that project (its organisation's members; the allocating office's officials within jurisdiction) — **and only when asking inside that project** | Participants who can manage it (organisation OWNER/ADMIN, assigned members, officials) | `projectId` required |
| `PRIVATE` | The uploader only | Anyone | `uploadedById` required |

`knowledge_sources_scope_consistent` enforces the "Database rule" column. The
title must also be 1–200 characters.

- **Visibility and ownership are fixed at creation.** Neither can be changed
  later; to re-scope a source, delete it and add it again.
- **Who may edit or delete:**
  - the uploader;
  - the owning organisation's OWNER or ADMIN;
  - a platform admin, for unowned PUBLIC sources.

## 4. Lifecycle

```
          create (text) / upload file / re-index
                 │
             PENDING ──▶ PROCESSING ──▶ COMPLETED ──(edit content / re-index)──▶ PENDING …
                              │
                              └──▶ FAILED ──(retry)──▶ PENDING …
```

- `POST /knowledge/sources/:id/ingest` is refused with `409` while a source is
  PROCESSING.
- Re-indexing replaces the document and every chunk in one transaction.
  Unchanged chunks keep their vectors (matched by content hash and model).
- Only COMPLETED sources are retrievable. Chunks embedded by a different
  model than the current query model are skipped, never compared.
- Deleting a source removes its documents, chunks and stored file. Both
  creation and deletion are audited (`KNOWLEDGE_SOURCE_CREATED`,
  `KNOWLEDGE_SOURCE_DELETED`).

### Failure reasons (the only messages shown)

| Code | Message |
| --- | --- |
| `NO_CONTENT` | There is nothing to index: add text or upload a file. |
| `EMPTY_DOCUMENT` | The document has no readable text. |
| `MALFORMED_DOCUMENT` | The document could not be read. Check that it is a valid file. |
| `UNSUPPORTED_DOCUMENT` | This file type is not supported. Use PDF, plain text, Markdown or HTML. |
| `DOCUMENT_TOO_LARGE` | The document is too large to index. |
| `EMBEDDING_UNAVAILABLE` | The embedding service is unavailable. Try again later. |
| `PROCESSING_UNAVAILABLE` | Document processing is unavailable. Try again later. |

## 5. Files

Uploaded files are stored under `knowledge/{sourceId}/{random}.{ext}`.

- **Served only by** `GET /knowledge/sources/:id/file`, after the same read
  check as the source.
- **The generic media route refuses `knowledge/` keys.**
- **Response headers:** `Content-Disposition: attachment`,
  `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`.
  HTML is served as `text/plain`.

## 6. Seed data

`npm run db:seed` adds three PUBLIC sample sources, titled "Sample guidance:
…":

- storm drains and culverts;
- pothole repair;
- streetlight faults.

They are clearly marked as illustrative Samadhaan guidance, not the policy of
any real authority. They are seeded PENDING with text only, and the API's
startup sweep chunks and embeds them with the real embedding model. Re-seeding
leaves already-indexed sources untouched.
