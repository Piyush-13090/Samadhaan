-- AI organisation matching (Prompt 14): organisation embeddings, match records,
-- and the ORGANIZATION_MATCHING job type.
--
-- NOTE: Prisma proposed DROP INDEX "problem_embeddings_vector_hnsw" here; removed
-- deliberately, as in earlier migrations — Prisma cannot express HNSW indexes.
-- CreateEnum
CREATE TYPE "OrganizationMatchStatus" AS ENUM ('CALCULATED', 'STALE', 'DISMISSED');

-- AlterEnum
ALTER TYPE "AnalysisType" ADD VALUE 'ORGANIZATION_MATCHING';

-- CreateTable
CREATE TABLE "organization_embeddings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL DEFAULT 384,
    "sourceHash" TEXT NOT NULL,
    "embedding" vector(384),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_problem_matches" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "semanticScore" DOUBLE PRECISION,
    "expertiseScore" DOUBLE PRECISION,
    "categoryScore" DOUBLE PRECISION,
    "geographicScore" DOUBLE PRECISION,
    "capabilityScore" DOUBLE PRECISION,
    "activityScore" DOUBLE PRECISION,
    "finalScore" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "matchingVersion" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "status" "OrganizationMatchStatus" NOT NULL DEFAULT 'CALCULATED',
    "explanation" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_problem_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_embeddings_organizationId_modelName_key" ON "organization_embeddings"("organizationId", "modelName");

-- CreateIndex
CREATE INDEX "organization_problem_matches_problemId_status_finalScore_idx" ON "organization_problem_matches"("problemId", "status", "finalScore" DESC);

-- CreateIndex
CREATE INDEX "organization_problem_matches_organizationId_status_finalSco_idx" ON "organization_problem_matches"("organizationId", "status", "finalScore" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "organization_problem_matches_problemId_organizationId_match_key" ON "organization_problem_matches"("problemId", "organizationId", "matchingVersion");

-- AddForeignKey
ALTER TABLE "organization_embeddings" ADD CONSTRAINT "organization_embeddings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_problem_matches" ADD CONSTRAINT "organization_problem_matches_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_problem_matches" ADD CONSTRAINT "organization_problem_matches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Approximate nearest-neighbour search over organisation profiles. Same
-- reasoning as problem_embeddings: HNSW needs no training pass, and the
-- vectors are normalised, so cosine ops. Also declared in post-migrate.sql so
-- `prisma migrate dev` cannot silently drop it.
CREATE INDEX IF NOT EXISTS "organization_embeddings_vector_hnsw"
  ON "organization_embeddings" USING hnsw ("embedding" vector_cosine_ops);
