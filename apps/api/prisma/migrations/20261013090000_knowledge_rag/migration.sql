-- Knowledge & RAG (Prompt 20): knowledge sources, extracted documents,
-- embedded chunks (pgvector) and RAG answer records.
--
-- NOTE: Prisma proposed DROP INDEX for the HNSW vector indexes here; removed
-- deliberately, as in earlier migrations.

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('CIVIC_GUIDELINE', 'GOVERNMENT_POLICY', 'PROJECT_DOCUMENT', 'PROJECT_NOTE', 'PROBLEM_CONTEXT', 'ORGANIZATION_DOCUMENT', 'WEB_REFERENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "KnowledgeVisibility" AS ENUM ('PUBLIC', 'GOVERNMENT', 'ORGANIZATION', 'PROJECT', 'PRIVATE');

-- CreateEnum
CREATE TYPE "KnowledgeIngestionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "visibility" "KnowledgeVisibility" NOT NULL,
    "organizationId" UUID,
    "projectId" UUID,
    "uploadedById" UUID,
    "externalUrl" TEXT,
    "storageKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "inlineText" TEXT,
    "categories" "ProblemCategory"[],
    "city" TEXT,
    "status" "KnowledgeIngestionStatus" NOT NULL DEFAULT 'PENDING',
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "embeddingModel" TEXT,
    "embeddingVersion" TEXT,
    "chunkerVersion" TEXT,
    "ingestedAt" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "knowledgeSourceId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "contentHash" TEXT NOT NULL,
    "pageCount" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "sectionTitle" TEXT,
    "pageNumber" INTEGER,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(384),
    "embeddingModel" TEXT NOT NULL,
    "embeddingVersion" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL DEFAULT 384,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_answers" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "contextType" TEXT NOT NULL,
    "problemId" UUID,
    "projectId" UUID,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "insufficientEvidence" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "modelName" TEXT,
    "modelVersion" TEXT,
    "promptVersion" TEXT,
    "embeddingModel" TEXT NOT NULL,
    "embeddingVersion" TEXT NOT NULL,
    "retrievalVersion" TEXT NOT NULL,
    "retrievedChunkIds" UUID[],
    "scores" JSONB,
    "retrievalMs" INTEGER,
    "generationMs" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_sources_visibility_status_idx" ON "knowledge_sources"("visibility", "status");

-- CreateIndex
CREATE INDEX "knowledge_sources_organizationId_visibility_idx" ON "knowledge_sources"("organizationId", "visibility");

-- CreateIndex
CREATE INDEX "knowledge_sources_projectId_idx" ON "knowledge_sources"("projectId");

-- CreateIndex
CREATE INDEX "knowledge_sources_uploadedById_idx" ON "knowledge_sources"("uploadedById");

-- CreateIndex
CREATE INDEX "knowledge_sources_status_updatedAt_idx" ON "knowledge_sources"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "knowledge_documents_knowledgeSourceId_idx" ON "knowledge_documents"("knowledgeSourceId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_sourceId_idx" ON "knowledge_chunks"("sourceId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_contentHash_embeddingModel_idx" ON "knowledge_chunks"("contentHash", "embeddingModel");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_documentId_chunkIndex_key" ON "knowledge_chunks"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "knowledge_answers_userId_createdAt_idx" ON "knowledge_answers"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "knowledge_answers_createdAt_idx" ON "knowledge_answers"("createdAt");

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "resolution_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_knowledgeSourceId_fkey" FOREIGN KEY ("knowledgeSourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_answers" ADD CONSTRAINT "knowledge_answers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Semantic retrieval: cosine HNSW over chunk embeddings.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_hnsw"
  ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- Keyword retrieval for the hybrid score: English full-text over chunk text.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_content_fts"
  ON "knowledge_chunks" USING gin (to_tsvector('english', "content"));

-- A restricted source can never exist without the owner its visibility needs:
-- otherwise a PROJECT or ORGANIZATION source with a null owner would match
-- nobody's filter today and could match the wrong one after a bad update.
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_scope_consistent" CHECK (
  ("visibility" <> 'PROJECT'      OR "projectId" IS NOT NULL) AND
  ("visibility" <> 'GOVERNMENT'   OR "organizationId" IS NOT NULL) AND
  ("visibility" <> 'ORGANIZATION' OR "organizationId" IS NOT NULL) AND
  ("visibility" <> 'PRIVATE'      OR "uploadedById" IS NOT NULL) AND
  char_length("title") BETWEEN 1 AND 200
);

ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_content_length"
  CHECK (char_length("content") BETWEEN 1 AND 8000);
