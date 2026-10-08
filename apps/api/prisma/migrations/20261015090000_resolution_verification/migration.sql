-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('BEFORE_AFTER_IMAGE', 'AFTER_IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION_PROOF', 'PROGRESS_UPDATE', 'OTHER');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PROCESSING', 'AI_REVIEWED', 'NEEDS_MORE_EVIDENCE', 'UNDER_GOVERNMENT_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "EvidenceFileRole" AS ENUM ('BEFORE', 'AFTER', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationRecommendation" AS ENUM ('INSUFFICIENT_EVIDENCE', 'POSSIBLY_RESOLVED', 'LIKELY_RESOLVED', 'LIKELY_NOT_RESOLVED');

-- CreateEnum
CREATE TYPE "VerificationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MORE_EVIDENCE_REQUESTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'RESOLUTION_EVIDENCE_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'RESOLUTION_EVIDENCE_REVIEWED';
ALTER TYPE "NotificationType" ADD VALUE 'RESOLUTION_VERIFICATION_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'RESOLUTION_MORE_EVIDENCE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'RESOLUTION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'RESOLUTION_REJECTED';

-- CreateTable
CREATE TABLE "resolution_evidence" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "submittedById" UUID NOT NULL,
    "evidenceType" "EvidenceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "replacesEvidenceId" UUID,
    "verificationRequestId" UUID,
    "aiStatus" TEXT,
    "aiAttempts" INTEGER NOT NULL DEFAULT 0,
    "decisionReason" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "withdrawnAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resolution_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_evidence_files" (
    "id" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "role" "EvidenceFileRole" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storedChecksum" TEXT NOT NULL,
    "perceptualHash" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "capturedAt" TIMESTAMPTZ(3),
    "gpsLatitude" DECIMAL(9,6),
    "gpsLongitude" DECIMAL(9,6),
    "locationDistanceM" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolution_evidence_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_verification_assessments" (
    "id" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "relevanceScore" DECIMAL(5,4),
    "visualConsistencyScore" DECIMAL(5,4),
    "completionSignalScore" DECIMAL(5,4),
    "locationConsistencyScore" DECIMAL(5,4),
    "documentationScore" DECIMAL(5,4),
    "temporalConsistencyScore" DECIMAL(5,4),
    "completenessScore" DECIMAL(5,4),
    "imageQualityScore" DECIMAL(5,4),
    "evidenceQuality" DECIMAL(5,2),
    "confidence" DECIMAL(5,4),
    "aiRecommendation" "VerificationRecommendation",
    "recommendation" "VerificationRecommendation",
    "explanation" JSONB NOT NULL,
    "evidenceReferences" JSONB,
    "concerns" JSONB,
    "missingEvidence" JSONB,
    "guidance" JSONB,
    "modelName" TEXT,
    "modelVersion" TEXT,
    "promptVersion" TEXT,
    "embeddingModel" TEXT,
    "embeddingVersion" TEXT,
    "verificationVersion" TEXT NOT NULL,
    "processingMs" INTEGER,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resolution_verification_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_verification_requests" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "note" TEXT,
    "status" "VerificationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "governmentOrganizationId" UUID NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionReason" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resolution_verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resolution_evidence_replacesEvidenceId_key" ON "resolution_evidence"("replacesEvidenceId");

-- CreateIndex
CREATE INDEX "resolution_evidence_projectId_createdAt_idx" ON "resolution_evidence"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "resolution_evidence_status_updatedAt_idx" ON "resolution_evidence"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "resolution_evidence_problemId_idx" ON "resolution_evidence"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "resolution_evidence_files_storageKey_key" ON "resolution_evidence_files"("storageKey");

-- CreateIndex
CREATE INDEX "resolution_evidence_files_evidenceId_idx" ON "resolution_evidence_files"("evidenceId");

-- CreateIndex
CREATE INDEX "resolution_evidence_files_checksum_idx" ON "resolution_evidence_files"("checksum");

-- CreateIndex
CREATE INDEX "resolution_verification_assessments_evidenceId_createdAt_idx" ON "resolution_verification_assessments"("evidenceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "resolution_verification_assessments_projectId_idx" ON "resolution_verification_assessments"("projectId");

-- CreateIndex
CREATE INDEX "resolution_verification_requests_projectId_createdAt_idx" ON "resolution_verification_requests"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "resolution_verification_requests_status_idx" ON "resolution_verification_requests"("status");

-- AddForeignKey
ALTER TABLE "resolution_evidence" ADD CONSTRAINT "resolution_evidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "resolution_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_evidence" ADD CONSTRAINT "resolution_evidence_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_evidence" ADD CONSTRAINT "resolution_evidence_replacesEvidenceId_fkey" FOREIGN KEY ("replacesEvidenceId") REFERENCES "resolution_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_evidence" ADD CONSTRAINT "resolution_evidence_verificationRequestId_fkey" FOREIGN KEY ("verificationRequestId") REFERENCES "resolution_verification_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_evidence_files" ADD CONSTRAINT "resolution_evidence_files_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "resolution_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_verification_assessments" ADD CONSTRAINT "resolution_verification_assessments_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "resolution_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_verification_requests" ADD CONSTRAINT "resolution_verification_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "resolution_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_verification_requests" ADD CONSTRAINT "resolution_verification_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_verification_requests" ADD CONSTRAINT "resolution_verification_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity the verification workflow relies on (Prompt 22).
ALTER TABLE "resolution_evidence"
  ADD CONSTRAINT "resolution_evidence_title_length" CHECK (char_length(btrim("title")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "resolution_evidence_description_length" CHECK ("description" IS NULL OR char_length("description") <= 4000),
  ADD CONSTRAINT "resolution_evidence_submitted_consistent" CHECK (("status" = 'DRAFT') = ("submittedAt" IS NULL) OR "status" = 'WITHDRAWN'),
  ADD CONSTRAINT "resolution_evidence_version_positive" CHECK ("version" >= 1);

ALTER TABLE "resolution_evidence_files"
  ADD CONSTRAINT "resolution_evidence_files_size_positive" CHECK ("fileSize" > 0),
  ADD CONSTRAINT "resolution_evidence_files_checksum_format" CHECK ("checksum" ~ '^[0-9a-f]{64}$' AND "storedChecksum" ~ '^[0-9a-f]{64}$');

ALTER TABLE "resolution_verification_assessments"
  ADD CONSTRAINT "resolution_verification_assessments_quality_bounds" CHECK ("evidenceQuality" IS NULL OR "evidenceQuality" BETWEEN 0 AND 100);

-- A refusal or a request for more evidence always carries a reason.
ALTER TABLE "resolution_verification_requests"
  ADD CONSTRAINT "resolution_verification_requests_reason_required" CHECK (
    "status" NOT IN ('REJECTED', 'MORE_EVIDENCE_REQUESTED')
    OR char_length(btrim(coalesce("decisionReason", ''))) >= 10
  ),
  ADD CONSTRAINT "resolution_verification_requests_decided_consistent" CHECK (
    ("status" = 'PENDING') = ("decidedAt" IS NULL)
  );

-- At most one pending verification request per project.
CREATE UNIQUE INDEX IF NOT EXISTS "resolution_verification_requests_one_pending"
  ON "resolution_verification_requests" ("projectId") WHERE "status" = 'PENDING';
