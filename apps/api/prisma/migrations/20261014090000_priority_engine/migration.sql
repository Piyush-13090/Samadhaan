-- CreateEnum
CREATE TYPE "PriorityTier" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PRIORITY_ESCALATED';

-- AlterTable
ALTER TABLE "problems" ADD COLUMN     "priorityAssessedAt" TIMESTAMPTZ(3),
ADD COLUMN     "priorityTier" "PriorityTier";

-- CreateTable
CREATE TABLE "problem_priority_assessments" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "priorityScore" DECIMAL(5,2) NOT NULL,
    "priorityTier" "PriorityTier" NOT NULL,
    "severityScore" DECIMAL(5,4),
    "urgencyScore" DECIMAL(5,4),
    "communityImpactScore" DECIMAL(5,4),
    "safetyRiskScore" DECIMAL(5,4),
    "geographicImpactScore" DECIMAL(5,4),
    "recencyScore" DECIMAL(5,4),
    "affectedPopulationScore" DECIMAL(5,4),
    "evidenceScore" DECIMAL(5,4),
    "confidence" DECIMAL(5,4) NOT NULL,
    "dataCompleteness" DECIMAL(5,4) NOT NULL,
    "modelName" TEXT,
    "modelVersion" TEXT,
    "promptVersion" TEXT,
    "aiStatus" TEXT NOT NULL,
    "scoringModel" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "featureVersion" TEXT NOT NULL,
    "explanation" JSONB NOT NULL,
    "featureMetadata" JSONB NOT NULL,
    "guidance" JSONB,
    "changes" JSONB,
    "outcomeHash" TEXT NOT NULL,
    "aiInputsHash" TEXT,
    "trigger" TEXT NOT NULL,
    "calculatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "problem_priority_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_priority_overrides" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "priorityTier" "PriorityTier" NOT NULL,
    "reason" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "overriddenById" UUID NOT NULL,
    "aiTier" "PriorityTier",
    "aiScore" DECIMAL(5,2),
    "assessmentId" UUID,
    "overriddenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "problem_priority_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "problem_priority_assessments_problemId_calculatedAt_idx" ON "problem_priority_assessments"("problemId", "calculatedAt" DESC);

-- CreateIndex
CREATE INDEX "problem_priority_assessments_calculatedAt_idx" ON "problem_priority_assessments"("calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "problem_priority_overrides_problemId_key" ON "problem_priority_overrides"("problemId");

-- CreateIndex
CREATE INDEX "problem_priority_overrides_organizationId_idx" ON "problem_priority_overrides"("organizationId");

-- CreateIndex
CREATE INDEX "problems_status_priorityTier_priorityScore_idx" ON "problems"("status", "priorityTier", "priorityScore");

-- AddForeignKey
ALTER TABLE "problem_priority_assessments" ADD CONSTRAINT "problem_priority_assessments_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_priority_overrides" ADD CONSTRAINT "problem_priority_overrides_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_priority_overrides" ADD CONSTRAINT "problem_priority_overrides_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_priority_overrides" ADD CONSTRAINT "problem_priority_overrides_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Bounds the engine relies on (Prompt 21).
ALTER TABLE "problem_priority_assessments"
  ADD CONSTRAINT "problem_priority_assessments_bounds" CHECK (
    "priorityScore" BETWEEN 0 AND 100
    AND "confidence" BETWEEN 0 AND 1
    AND "dataCompleteness" BETWEEN 0 AND 1
    AND coalesce("severityScore", 0) BETWEEN 0 AND 1
    AND coalesce("urgencyScore", 0) BETWEEN 0 AND 1
    AND coalesce("communityImpactScore", 0) BETWEEN 0 AND 1
    AND coalesce("safetyRiskScore", 0) BETWEEN 0 AND 1
    AND coalesce("geographicImpactScore", 0) BETWEEN 0 AND 1
    AND coalesce("recencyScore", 0) BETWEEN 0 AND 1
    AND coalesce("affectedPopulationScore", 0) BETWEEN 0 AND 1
    AND coalesce("evidenceScore", 0) BETWEEN 0 AND 1
  );

-- An override always carries a reason.
ALTER TABLE "problem_priority_overrides"
  ADD CONSTRAINT "problem_priority_overrides_reason_length"
  CHECK (char_length(btrim("reason")) BETWEEN 10 AND 1000);
