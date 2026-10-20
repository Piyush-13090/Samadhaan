-- Prompt 28: model registry, active-model pointer and inference monitoring.
-- See docs/MODEL_REGISTRY.md and docs/MODEL_LIFECYCLE.md. Generated with
-- `prisma migrate diff`, plus the CHECK constraints below (Prisma cannot
-- express them). The one-ACTIVE-per-task partial unique index lives in
-- prisma/sql/post-migrate.sql with the other partial indexes.

-- CreateEnum
CREATE TYPE "ModelTask" AS ENUM ('PROBLEM_CATEGORY', 'PROBLEM_SEVERITY', 'PROBLEM_URGENCY', 'DUPLICATE_PAIR');

-- CreateEnum
CREATE TYPE "ModelStatus" AS ENUM ('EXPERIMENTAL', 'EVALUATED', 'APPROVED', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ModelInferenceOutcome" AS ENUM ('OK', 'ABSTAINED', 'INPUT_SCHEMA', 'ARTIFACT_ERROR', 'TIMEOUT', 'ERROR');

-- CreateTable
CREATE TABLE "model_versions" (
    "id" UUID NOT NULL,
    "task" "ModelTask" NOT NULL,
    "version" TEXT NOT NULL,
    "status" "ModelStatus" NOT NULL DEFAULT 'EXPERIMENTAL',
    "modelFormat" TEXT NOT NULL,
    "artifactUri" TEXT NOT NULL,
    "artifactSha256" CHAR(64) NOT NULL,
    "featureSchemaVersion" TEXT NOT NULL,
    "labelSchemaVersion" TEXT NOT NULL,
    "datasetName" TEXT NOT NULL,
    "datasetVersion" TEXT NOT NULL,
    "datasetFingerprint" TEXT NOT NULL,
    "syntheticData" BOOLEAN NOT NULL,
    "trainingConfig" JSONB NOT NULL,
    "codeRevision" TEXT,
    "trainedAt" TIMESTAMPTZ(3) NOT NULL,
    "trainingMetrics" JSONB NOT NULL,
    "evaluationDatasetVersion" TEXT,
    "evaluationMetrics" JSONB,
    "evaluatedAt" TIMESTAMPTZ(3),
    "evaluatedById" UUID,
    "registeredById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "approvalNote" TEXT,
    "activatedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_models" (
    "task" "ModelTask" NOT NULL,
    "modelVersionId" UUID,
    "previousModelVersionId" UUID,
    "activatedById" UUID NOT NULL,
    "activatedAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "active_models_pkey" PRIMARY KEY ("task")
);

-- CreateTable
CREATE TABLE "model_inferences" (
    "id" UUID NOT NULL,
    "task" "ModelTask" NOT NULL,
    "modelVersionId" UUID,
    "outcome" "ModelInferenceOutcome" NOT NULL,
    "latencyMs" INTEGER,
    "predictedLabel" TEXT,
    "confidence" DECIMAL(5,4),
    "abstainReason" TEXT,
    "missingFeatures" INTEGER NOT NULL DEFAULT 0,
    "inputLength" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_inferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "model_versions_task_status_idx" ON "model_versions"("task", "status");

-- CreateIndex
CREATE UNIQUE INDEX "model_versions_task_version_key" ON "model_versions"("task", "version");

-- CreateIndex
CREATE UNIQUE INDEX "active_models_modelVersionId_key" ON "active_models"("modelVersionId");

-- CreateIndex
CREATE INDEX "model_inferences_task_createdAt_idx" ON "model_inferences"("task", "createdAt");

-- CreateIndex
CREATE INDEX "model_inferences_modelVersionId_createdAt_idx" ON "model_inferences"("modelVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "model_inferences_createdAt_idx" ON "model_inferences"("createdAt");

-- AddForeignKey
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_evaluatedById_fkey" FOREIGN KEY ("evaluatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_models" ADD CONSTRAINT "active_models_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_models" ADD CONSTRAINT "active_models_previousModelVersionId_fkey" FOREIGN KEY ("previousModelVersionId") REFERENCES "model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_models" ADD CONSTRAINT "active_models_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_inferences" ADD CONSTRAINT "model_inferences_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Integrity the application also enforces, so no other writer can break it.
ALTER TABLE "model_versions"
  ADD CONSTRAINT "model_versions_sha256_hex" CHECK ("artifactSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "model_versions_version_safe" CHECK ("version" ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  ADD CONSTRAINT "model_versions_artifact_uri" CHECK ("artifactUri" = lower("task"::text) || '/' || "version"),
  -- A synthetic-data model can never leave EXPERIMENTAL.
  ADD CONSTRAINT "model_versions_synthetic_experimental" CHECK (NOT "syntheticData" OR "status" IN ('EXPERIMENTAL', 'RETIRED')),
  -- Approval and evaluation are recorded with who and when.
  ADD CONSTRAINT "model_versions_approved_has_approver" CHECK ("status" NOT IN ('APPROVED', 'ACTIVE') OR ("approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL AND "evaluatedAt" IS NOT NULL)),
  -- Separation of duties: the registrant does not approve their own model.
  ADD CONSTRAINT "model_versions_approver_not_registrant" CHECK ("approvedById" IS NULL OR "approvedById" <> "registeredById");

ALTER TABLE "model_inferences"
  ADD CONSTRAINT "model_inferences_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  ADD CONSTRAINT "model_inferences_latency_range" CHECK ("latencyMs" IS NULL OR "latencyMs" >= 0),
  ADD CONSTRAINT "model_inferences_missing_range" CHECK ("missingFeatures" >= 0);
