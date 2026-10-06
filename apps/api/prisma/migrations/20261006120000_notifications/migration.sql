-- Notifications and the activity center (Prompt 11).

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('AI_ANALYSIS_COMPLETED', 'AI_ANALYSIS_FAILED', 'POSSIBLE_DUPLICATE_FOUND', 'PROBLEM_SUPPORTED', 'PROBLEM_COMMENTED', 'COMMENT_REPLIED', 'FOLLOWED_PROBLEM_UPDATED', 'PROBLEM_STATUS_CHANGED');

-- CreateEnum
CREATE TYPE "NotificationEntityType" AS ENUM ('PROBLEM', 'COMMENT', 'DUPLICATE', 'SYSTEM');


-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" "NotificationEntityType" NOT NULL,
    "entityId" UUID,
    "metadata" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipientId_createdAt_id_idx" ON "notifications"("recipientId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "notifications_recipientId_readAt_idx" ON "notifications"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipientId_dedupeKey_key" ON "notifications"("recipientId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Bounded, so a bug or a hostile payload cannot turn a notification row into a
-- document store. Matches the limits the API applies before writing.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_title_length" CHECK (length("title") BETWEEN 1 AND 120),
  ADD CONSTRAINT "notifications_message_length" CHECK (length("message") BETWEEN 1 AND 300),
  ADD CONSTRAINT "notifications_dedupe_key_length" CHECK (length("dedupeKey") BETWEEN 1 AND 200),
  ADD CONSTRAINT "notifications_metadata_size"
    CHECK ("metadata" IS NULL OR pg_column_size("metadata") <= 2048);
