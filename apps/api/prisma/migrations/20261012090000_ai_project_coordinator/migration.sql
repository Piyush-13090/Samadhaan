-- AI Project Coordinator (Prompt 19): persisted insights, coordinator
-- questions and structured project updates.
--
-- NOTE: Prisma proposed DROP INDEX for both HNSW vector indexes here; removed
-- deliberately, as in earlier migrations.

-- CreateEnum
CREATE TYPE "ProjectHealth" AS ENUM ('HEALTHY', 'NEEDS_ATTENTION', 'AT_RISK', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CoordinatorInsightStatus" AS ENUM ('COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CoordinatorTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "CoordinatorQuestionStatus" AS ENUM ('OPEN', 'ANSWERED', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProjectUpdateSource" AS ENUM ('MANUAL', 'AI_ASSISTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_COORDINATOR_ALERT';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_COORDINATOR_QUESTION';

-- AlterEnum
ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'PROJECT_UPDATE_POSTED';

-- CreateTable
CREATE TABLE "project_ai_insights" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "status" "CoordinatorInsightStatus" NOT NULL,
    "trigger" "CoordinatorTrigger" NOT NULL,
    "requestedById" UUID,
    "baselineHealth" "ProjectHealth" NOT NULL,
    "health" "ProjectHealth",
    "healthReason" TEXT,
    "summary" TEXT,
    "risks" JSONB,
    "blockers" JSONB,
    "suggestions" JSONB,
    "deadlines" JSONB,
    "signals" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "provider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "processingMs" INTEGER,
    "droppedItems" INTEGER NOT NULL DEFAULT 0,
    "basedOnChangeAt" TIMESTAMPTZ(3) NOT NULL,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coordinator_questions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "insightId" UUID,
    "question" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "targetRef" TEXT,
    "sourceRefs" JSONB NOT NULL,
    "status" "CoordinatorQuestionStatus" NOT NULL DEFAULT 'OPEN',
    "askedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "answer" TEXT,
    "answeredAt" TIMESTAMPTZ(3),
    "answeredById" UUID,
    "dismissedAt" TIMESTAMPTZ(3),
    "dismissedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "coordinator_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_updates" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "authorOrganizationId" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "completed" TEXT[],
    "current" TEXT[],
    "blockers" TEXT[],
    "nextSteps" TEXT[],
    "source" "ProjectUpdateSource" NOT NULL DEFAULT 'MANUAL',
    "aiModel" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_ai_insights_projectId_status_generatedAt_idx" ON "project_ai_insights"("projectId", "status", "generatedAt");

-- CreateIndex
CREATE INDEX "coordinator_questions_projectId_status_askedAt_idx" ON "coordinator_questions"("projectId", "status", "askedAt");

-- CreateIndex
CREATE INDEX "coordinator_questions_projectId_fingerprint_idx" ON "coordinator_questions"("projectId", "fingerprint");

-- CreateIndex
CREATE INDEX "project_updates_projectId_createdAt_idx" ON "project_updates"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "project_ai_insights" ADD CONSTRAINT "project_ai_insights_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "resolution_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ai_insights" ADD CONSTRAINT "project_ai_insights_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coordinator_questions" ADD CONSTRAINT "coordinator_questions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "resolution_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coordinator_questions" ADD CONSTRAINT "coordinator_questions_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "project_ai_insights"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coordinator_questions" ADD CONSTRAINT "coordinator_questions_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coordinator_questions" ADD CONSTRAINT "coordinator_questions_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "resolution_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_authorOrganizationId_fkey" FOREIGN KEY ("authorOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- One OPEN question per fingerprint per project: the coordinator cannot ask
-- the same thing twice at once, even from two concurrent refreshes.
CREATE UNIQUE INDEX IF NOT EXISTS "coordinator_questions_one_open"
  ON "coordinator_questions" ("projectId", "fingerprint")
  WHERE "status" = 'OPEN';

ALTER TABLE "coordinator_questions" ADD CONSTRAINT "coordinator_questions_state_consistent" CHECK (
  ("status" <> 'ANSWERED'  OR ("answer" IS NOT NULL AND "answeredAt" IS NOT NULL AND "answeredById" IS NOT NULL)) AND
  ("status" <> 'DISMISSED' OR ("dismissedAt" IS NOT NULL)) AND
  char_length("question") BETWEEN 1 AND 400
);

ALTER TABLE "project_ai_insights" ADD CONSTRAINT "project_ai_insights_state_consistent" CHECK (
  ("status" <> 'COMPLETED' OR ("health" IS NOT NULL AND "summary" IS NOT NULL)) AND
  ("status" <> 'FAILED'    OR "failureCode" IS NOT NULL) AND
  "expiresAt" > "generatedAt"
);

ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_summary_length"
  CHECK (char_length("summary") BETWEEN 1 AND 400);
