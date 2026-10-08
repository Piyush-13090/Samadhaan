-- CreateEnum
CREATE TYPE "ImpactTransactionType" AS ENUM ('PROBLEM_REPORTED', 'PROBLEM_VERIFIED', 'DUPLICATE_IDENTIFIED', 'USEFUL_COMMENT', 'PROBLEM_SUPPORTED', 'PROJECT_CONTRIBUTION', 'TASK_COMPLETED', 'MILESTONE_COMPLETED', 'RESOLUTION_EVIDENCE_SUBMITTED', 'PROBLEM_RESOLVED', 'QUALITY_BONUS', 'PENALTY', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReputationTier" AS ENUM ('NEW_CONTRIBUTOR', 'ACTIVE_CONTRIBUTOR', 'TRUSTED_CONTRIBUTOR', 'CIVIC_CHAMPION', 'CIVIC_LEADER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'IMPACT_POINTS_AWARDED';
ALTER TYPE "NotificationType" ADD VALUE 'BADGE_EARNED';
ALTER TYPE "NotificationType" ADD VALUE 'REPUTATION_TIER_REACHED';

-- CreateTable
CREATE TABLE "impact_point_transactions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "ImpactTransactionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" UUID,
    "problemId" UUID,
    "ruleVersion" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorUserId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impact_point_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_impact_stats" (
    "userId" UUID NOT NULL,
    "impactPoints" INTEGER NOT NULL DEFAULT 0,
    "resolvedContributions" INTEGER NOT NULL DEFAULT 0,
    "reputationScore" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "reputationTier" "ReputationTier" NOT NULL DEFAULT 'NEW_CONTRIBUTOR',
    "reputationVersion" TEXT,
    "reputationUpdatedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_impact_stats_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "badge_definitions" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "badge_definitions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "badgeKey" TEXT NOT NULL,
    "evidence" JSONB,
    "awardedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "impact_point_transactions_idempotencyKey_key" ON "impact_point_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "impact_point_transactions_userId_createdAt_idx" ON "impact_point_transactions"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "impact_point_transactions_type_createdAt_idx" ON "impact_point_transactions"("type", "createdAt");

-- CreateIndex
CREATE INDEX "impact_point_transactions_entityId_idx" ON "impact_point_transactions"("entityId");

-- CreateIndex
CREATE INDEX "impact_point_transactions_problemId_idx" ON "impact_point_transactions"("problemId");

-- CreateIndex
CREATE INDEX "impact_point_transactions_createdAt_idx" ON "impact_point_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "user_impact_stats_impactPoints_idx" ON "user_impact_stats"("impactPoints" DESC);

-- CreateIndex
CREATE INDEX "user_impact_stats_reputationScore_idx" ON "user_impact_stats"("reputationScore" DESC);

-- CreateIndex
CREATE INDEX "user_badges_badgeKey_idx" ON "user_badges"("badgeKey");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_userId_badgeKey_key" ON "user_badges"("userId", "badgeKey");

-- AddForeignKey
ALTER TABLE "impact_point_transactions" ADD CONSTRAINT "impact_point_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_impact_stats" ADD CONSTRAINT "user_impact_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badgeKey_fkey" FOREIGN KEY ("badgeKey") REFERENCES "badge_definitions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- The impact ledger is append-only (Prompt 23): points are corrected by a new
-- transaction, never by editing or deleting one. As with audit_logs, only an
-- explicit maintenance session (`samadhaan.audit_maintenance = on`, test
-- clean-up or data-protection erasure) may change rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION impact_ledger_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('samadhaan.audit_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER impact_point_transactions_append_only
  BEFORE UPDATE OR DELETE ON "impact_point_transactions"
  FOR EACH ROW EXECUTE FUNCTION impact_ledger_append_only();

-- Badges, once earned, are kept.
CREATE TRIGGER user_badges_append_only
  BEFORE UPDATE OR DELETE ON "user_badges"
  FOR EACH ROW EXECUTE FUNCTION impact_ledger_append_only();

ALTER TABLE "impact_point_transactions"
  ADD CONSTRAINT "impact_point_transactions_amount_nonzero" CHECK ("amount" <> 0 AND abs("amount") <= 10000),
  ADD CONSTRAINT "impact_point_transactions_reason_length" CHECK (char_length(btrim("reason")) BETWEEN 1 AND 500),
  -- Administrative adjustments always name the administrator.
  ADD CONSTRAINT "impact_point_transactions_adjustment_actor" CHECK ("type" <> 'ADMIN_ADJUSTMENT' OR "actorUserId" IS NOT NULL);

ALTER TABLE "user_impact_stats"
  ADD CONSTRAINT "user_impact_stats_bounds" CHECK ("reputationScore" BETWEEN 0 AND 100 AND "resolvedContributions" >= 0);
