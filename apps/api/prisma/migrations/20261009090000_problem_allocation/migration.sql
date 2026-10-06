-- Government allocation (Prompt 16): problem_allocations, its status enum,
-- and allocation notification types.
--
-- NOTE: Prisma proposed DROP INDEX for both HNSW vector indexes here; removed
-- deliberately, as in earlier migrations.

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "NotificationEntityType" ADD VALUE 'ALLOCATION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ALLOCATION_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'ALLOCATION_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'ALLOCATION_DECLINED';
ALTER TYPE "NotificationType" ADD VALUE 'ALLOCATION_CANCELLED';

-- CreateTable
CREATE TABLE "problem_allocations" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "governmentOrganizationId" UUID NOT NULL,
    "allocatedById" UUID NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'PENDING',
    "instructions" TEXT,
    "internalReason" TEXT,
    "responseNote" TEXT,
    "declineReason" TEXT,
    "respondedById" UUID,
    "cancellationReason" TEXT,
    "cancelledById" UUID,
    "proposedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "declinedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "problem_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "problem_allocations_problemId_createdAt_idx" ON "problem_allocations"("problemId", "createdAt");

-- CreateIndex
CREATE INDEX "problem_allocations_organizationId_status_createdAt_idx" ON "problem_allocations"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "problem_allocations_governmentOrganizationId_status_idx" ON "problem_allocations"("governmentOrganizationId", "status");

-- AddForeignKey
ALTER TABLE "problem_allocations" ADD CONSTRAINT "problem_allocations_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_allocations" ADD CONSTRAINT "problem_allocations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_allocations" ADD CONSTRAINT "problem_allocations_governmentOrganizationId_fkey" FOREIGN KEY ("governmentOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_allocations" ADD CONSTRAINT "problem_allocations_allocatedById_fkey" FOREIGN KEY ("allocatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_allocations" ADD CONSTRAINT "problem_allocations_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_allocations" ADD CONSTRAINT "problem_allocations_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- One active allocation per problem.
--
-- A partial unique index, so the guarantee holds under concurrency: two
-- officials allocating the same problem at once cannot both insert a PENDING
-- row — the second insert fails on this index and the API answers 409. A
-- check-then-insert in application code alone would race.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "problem_allocations_one_active"
  ON "problem_allocations" ("problemId")
  WHERE "status" IN ('PENDING', 'ACCEPTED');

-- Timestamps must agree with the status, so no code path can write an
-- ACCEPTED row without an acceptance time, or the like.
ALTER TABLE "problem_allocations" ADD CONSTRAINT "problem_allocations_state_consistent" CHECK (
  ("status" <> 'ACCEPTED'  OR ("acceptedAt"  IS NOT NULL AND "respondedAt" IS NOT NULL)) AND
  ("status" <> 'DECLINED'  OR ("declinedAt"  IS NOT NULL AND "respondedAt" IS NOT NULL AND "declineReason" IS NOT NULL)) AND
  ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL)) AND
  ("status" <> 'PENDING'   OR ("respondedAt" IS NULL AND "cancelledAt" IS NULL))
);
