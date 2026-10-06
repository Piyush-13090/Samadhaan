-- Resolution rooms (Prompt 17): the private collaboration space opened when
-- an organisation accepts a government allocation.
--
-- NOTE: Prisma proposed DROP INDEX for both HNSW vector indexes here; removed
-- deliberately, as in earlier migrations.

-- CreateEnum
CREATE TYPE "ResolutionRoomStatus" AS ENUM ('OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ResolutionParticipantSide" AS ENUM ('GOVERNMENT', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "ResolutionRoomEventType" AS ENUM ('ROOM_CREATED', 'PARTICIPANT_JOINED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'ATTACHMENT_ADDED', 'ROOM_CLOSED');

-- AlterEnum
ALTER TYPE "NotificationEntityType" ADD VALUE 'RESOLUTION_ROOM';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'RESOLUTION_MESSAGE';
ALTER TYPE "NotificationType" ADD VALUE 'RESOLUTION_MENTION';
ALTER TYPE "NotificationType" ADD VALUE 'RESOLUTION_ROOM_CLOSED';

-- CreateTable
CREATE TABLE "resolution_rooms" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "governmentOrganizationId" UUID NOT NULL,
    "assignedOrganizationId" UUID NOT NULL,
    "status" "ResolutionRoomStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMPTZ(3),
    "closedById" UUID,
    "closeReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resolution_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_messages" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "authorOrganizationId" UUID NOT NULL,
    "authorSide" "ResolutionParticipantSide" NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resolution_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_message_mentions" (
    "messageId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "resolution_message_mentions_pkey" PRIMARY KEY ("messageId","userId")
);

-- CreateTable
CREATE TABLE "resolution_attachments" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "messageId" UUID,
    "uploadedById" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolution_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_room_events" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "type" "ResolutionRoomEventType" NOT NULL,
    "actorId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolution_room_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_room_reads" (
    "roomId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lastReadAt" TIMESTAMPTZ(3),
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolution_room_reads_pkey" PRIMARY KEY ("roomId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "resolution_rooms_allocationId_key" ON "resolution_rooms"("allocationId");

-- CreateIndex
CREATE INDEX "resolution_rooms_governmentOrganizationId_status_idx" ON "resolution_rooms"("governmentOrganizationId", "status");

-- CreateIndex
CREATE INDEX "resolution_rooms_assignedOrganizationId_status_idx" ON "resolution_rooms"("assignedOrganizationId", "status");

-- CreateIndex
CREATE INDEX "resolution_rooms_problemId_idx" ON "resolution_rooms"("problemId");

-- CreateIndex
CREATE INDEX "resolution_messages_roomId_createdAt_id_idx" ON "resolution_messages"("roomId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "resolution_message_mentions_userId_idx" ON "resolution_message_mentions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "resolution_attachments_storageKey_key" ON "resolution_attachments"("storageKey");

-- CreateIndex
CREATE INDEX "resolution_attachments_roomId_createdAt_idx" ON "resolution_attachments"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "resolution_attachments_messageId_idx" ON "resolution_attachments"("messageId");

-- CreateIndex
CREATE INDEX "resolution_room_events_roomId_createdAt_idx" ON "resolution_room_events"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "resolution_room_reads_userId_idx" ON "resolution_room_reads"("userId");

-- AddForeignKey
ALTER TABLE "resolution_rooms" ADD CONSTRAINT "resolution_rooms_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_rooms" ADD CONSTRAINT "resolution_rooms_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "problem_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_rooms" ADD CONSTRAINT "resolution_rooms_governmentOrganizationId_fkey" FOREIGN KEY ("governmentOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_rooms" ADD CONSTRAINT "resolution_rooms_assignedOrganizationId_fkey" FOREIGN KEY ("assignedOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_rooms" ADD CONSTRAINT "resolution_rooms_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_messages" ADD CONSTRAINT "resolution_messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "resolution_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_messages" ADD CONSTRAINT "resolution_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_messages" ADD CONSTRAINT "resolution_messages_authorOrganizationId_fkey" FOREIGN KEY ("authorOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_message_mentions" ADD CONSTRAINT "resolution_message_mentions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "resolution_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_message_mentions" ADD CONSTRAINT "resolution_message_mentions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_attachments" ADD CONSTRAINT "resolution_attachments_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "resolution_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_attachments" ADD CONSTRAINT "resolution_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "resolution_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_attachments" ADD CONSTRAINT "resolution_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_room_events" ADD CONSTRAINT "resolution_room_events_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "resolution_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_room_events" ADD CONSTRAINT "resolution_room_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_room_reads" ADD CONSTRAINT "resolution_room_reads_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "resolution_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_room_reads" ADD CONSTRAINT "resolution_room_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- A room exists only for an ACCEPTED allocation, and agrees with it.
--
-- The API creates rooms inside the acceptance transaction, after the
-- allocation row is updated, so the trigger sees ACCEPTED. Anything else —
-- a pending, declined or cancelled allocation, or a room whose problem or
-- organisations differ from the allocation's — is refused by the database.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolution_rooms_require_accepted_allocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  a RECORD;
BEGIN
  SELECT status, "problemId", "organizationId", "governmentOrganizationId"
    INTO a FROM problem_allocations WHERE id = NEW."allocationId";
  IF a IS NULL OR a.status <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'A resolution room requires an accepted allocation'
      USING ERRCODE = 'check_violation';
  END IF;
  IF a."problemId" <> NEW."problemId"
     OR a."organizationId" <> NEW."assignedOrganizationId"
     OR a."governmentOrganizationId" <> NEW."governmentOrganizationId" THEN
    RAISE EXCEPTION 'A resolution room must match its allocation'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER resolution_rooms_accepted_allocation
  BEFORE INSERT OR UPDATE OF "allocationId", "problemId", "assignedOrganizationId", "governmentOrganizationId"
  ON resolution_rooms
  FOR EACH ROW EXECUTE FUNCTION resolution_rooms_require_accepted_allocation();

-- A closed room carries when and why.
ALTER TABLE "resolution_rooms" ADD CONSTRAINT "resolution_rooms_closed_consistent" CHECK (
  ("status" <> 'CLOSED' OR ("closedAt" IS NOT NULL AND "closeReason" IS NOT NULL)) AND
  ("status" <> 'OPEN'   OR ("closedAt" IS NULL))
);

-- Bounded text at the database too, whatever the API does.
ALTER TABLE "resolution_messages" ADD CONSTRAINT "resolution_messages_body_length"
  CHECK (char_length("body") BETWEEN 1 AND 4000);

-- Backfill: allocations accepted before this migration get their room.
INSERT INTO "resolution_rooms" ("id", "problemId", "allocationId", "governmentOrganizationId", "assignedOrganizationId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a."problemId", a.id, a."governmentOrganizationId", a."organizationId", COALESCE(a."acceptedAt", now()), now()
FROM problem_allocations a
WHERE a.status = 'ACCEPTED'
  AND NOT EXISTS (SELECT 1 FROM resolution_rooms r WHERE r."allocationId" = a.id);

INSERT INTO "resolution_room_events" ("id", "roomId", "type", "metadata", "createdAt")
SELECT gen_random_uuid(), r.id, 'ROOM_CREATED', jsonb_build_object('backfilled', true), r."createdAt"
FROM resolution_rooms r
WHERE NOT EXISTS (SELECT 1 FROM resolution_room_events e WHERE e."roomId" = r.id AND e.type = 'ROOM_CREATED');
