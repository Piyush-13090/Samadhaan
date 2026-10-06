-- Resolution projects (Prompt 18): the structured plan inside a resolution
-- room — project, milestones, tasks — and their activity event types.
--
-- NOTE: Prisma proposed DROP INDEX for both HNSW vector indexes here; removed
-- deliberately, as in earlier migrations.

-- CreateEnum
CREATE TYPE "ResolutionProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResolutionTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResolutionTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterEnum
ALTER TYPE "NotificationEntityType" ADD VALUE 'RESOLUTION_PROJECT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_TASK_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_TASK_DUE_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_TASK_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_MILESTONE_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_STATUS_CHANGED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'PROJECT_CREATED';
ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'PROJECT_UPDATED';
ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'PROJECT_STATUS_CHANGED';
ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'TASK_CREATED';
ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'TASK_UPDATED';
ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'TASK_ASSIGNED';
ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'TASK_STATUS_CHANGED';
ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'MILESTONE_CREATED';
ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'MILESTONE_UPDATED';
ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'MILESTONE_COMPLETED';
ALTER TYPE "ResolutionRoomEventType" ADD VALUE 'MILESTONE_REOPENED';

-- CreateTable
CREATE TABLE "resolution_projects" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "governmentOrganizationId" UUID NOT NULL,
    "assignedOrganizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ResolutionProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "startDate" DATE,
    "targetDate" DATE,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resolution_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_milestones" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" DATE,
    "completedAt" TIMESTAMPTZ(3),
    "completedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resolution_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_tasks" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "milestoneId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ResolutionTaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "ResolutionTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" UUID,
    "dueDate" DATE,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "completedById" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resolution_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_task_attachments" (
    "taskId" UUID NOT NULL,
    "attachmentId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolution_task_attachments_pkey" PRIMARY KEY ("taskId","attachmentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "resolution_projects_roomId_key" ON "resolution_projects"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "resolution_projects_allocationId_key" ON "resolution_projects"("allocationId");

-- CreateIndex
CREATE INDEX "resolution_projects_governmentOrganizationId_status_idx" ON "resolution_projects"("governmentOrganizationId", "status");

-- CreateIndex
CREATE INDEX "resolution_projects_assignedOrganizationId_status_idx" ON "resolution_projects"("assignedOrganizationId", "status");

-- CreateIndex
CREATE INDEX "resolution_projects_problemId_idx" ON "resolution_projects"("problemId");

-- CreateIndex
CREATE INDEX "resolution_milestones_projectId_dueDate_idx" ON "resolution_milestones"("projectId", "dueDate");

-- CreateIndex
CREATE INDEX "resolution_tasks_projectId_status_idx" ON "resolution_tasks"("projectId", "status");

-- CreateIndex
CREATE INDEX "resolution_tasks_projectId_dueDate_idx" ON "resolution_tasks"("projectId", "dueDate");

-- CreateIndex
CREATE INDEX "resolution_tasks_projectId_milestoneId_idx" ON "resolution_tasks"("projectId", "milestoneId");

-- CreateIndex
CREATE INDEX "resolution_tasks_assignedToId_status_idx" ON "resolution_tasks"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "resolution_task_attachments_attachmentId_idx" ON "resolution_task_attachments"("attachmentId");

-- AddForeignKey
ALTER TABLE "resolution_projects" ADD CONSTRAINT "resolution_projects_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "resolution_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_projects" ADD CONSTRAINT "resolution_projects_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_projects" ADD CONSTRAINT "resolution_projects_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "problem_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_projects" ADD CONSTRAINT "resolution_projects_governmentOrganizationId_fkey" FOREIGN KEY ("governmentOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_projects" ADD CONSTRAINT "resolution_projects_assignedOrganizationId_fkey" FOREIGN KEY ("assignedOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_projects" ADD CONSTRAINT "resolution_projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_milestones" ADD CONSTRAINT "resolution_milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "resolution_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_milestones" ADD CONSTRAINT "resolution_milestones_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_milestones" ADD CONSTRAINT "resolution_milestones_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_tasks" ADD CONSTRAINT "resolution_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "resolution_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_tasks" ADD CONSTRAINT "resolution_tasks_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "resolution_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_tasks" ADD CONSTRAINT "resolution_tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_tasks" ADD CONSTRAINT "resolution_tasks_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_tasks" ADD CONSTRAINT "resolution_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_task_attachments" ADD CONSTRAINT "resolution_task_attachments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "resolution_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_task_attachments" ADD CONSTRAINT "resolution_task_attachments_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "resolution_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- A project belongs to its room: same problem, allocation and organisations.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolution_projects_match_room()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT "problemId", "allocationId", "governmentOrganizationId", "assignedOrganizationId"
    INTO r FROM resolution_rooms WHERE id = NEW."roomId";
  IF r IS NULL
     OR r."problemId" <> NEW."problemId"
     OR r."allocationId" <> NEW."allocationId"
     OR r."governmentOrganizationId" <> NEW."governmentOrganizationId"
     OR r."assignedOrganizationId" <> NEW."assignedOrganizationId" THEN
    RAISE EXCEPTION 'A resolution project must match its room'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER resolution_projects_room_match
  BEFORE INSERT OR UPDATE OF "roomId", "problemId", "allocationId", "governmentOrganizationId", "assignedOrganizationId"
  ON resolution_projects
  FOR EACH ROW EXECUTE FUNCTION resolution_projects_match_room();

-- States carry their timestamps; dates are in order; text is bounded.
ALTER TABLE "resolution_projects" ADD CONSTRAINT "resolution_projects_state_consistent" CHECK (
  ("status" <> 'COMPLETED' OR "completedAt" IS NOT NULL) AND
  ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL) AND
  ("status" <> 'PLANNED'   OR ("completedAt" IS NULL AND "cancelledAt" IS NULL)) AND
  ("targetDate" IS NULL OR "startDate" IS NULL OR "targetDate" >= "startDate") AND
  char_length("name") BETWEEN 1 AND 200
);

ALTER TABLE "resolution_tasks" ADD CONSTRAINT "resolution_tasks_state_consistent" CHECK (
  ("status" <> 'COMPLETED' OR ("completedAt" IS NOT NULL AND "completedById" IS NOT NULL)) AND
  ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL) AND
  ("status" IN ('COMPLETED') OR "completedAt" IS NULL) AND
  char_length("title") BETWEEN 1 AND 200
);

ALTER TABLE "resolution_milestones" ADD CONSTRAINT "resolution_milestones_consistent" CHECK (
  ("completedAt" IS NULL) = ("completedById" IS NULL) AND
  char_length("title") BETWEEN 1 AND 200
);

-- A task's milestone must be in the same project.
CREATE OR REPLACE FUNCTION resolution_tasks_milestone_same_project()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."milestoneId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM resolution_milestones m
    WHERE m.id = NEW."milestoneId" AND m."projectId" = NEW."projectId"
  ) THEN
    RAISE EXCEPTION 'A task''s milestone must belong to the same project'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER resolution_tasks_milestone_project
  BEFORE INSERT OR UPDATE OF "milestoneId", "projectId"
  ON resolution_tasks
  FOR EACH ROW EXECUTE FUNCTION resolution_tasks_milestone_same_project();

-- Backfill: rooms opened before this migration get their project. (No
-- PROJECT_CREATED event: a new enum value cannot be used in the transaction
-- that adds it.)
INSERT INTO "resolution_projects" ("id", "roomId", "problemId", "allocationId", "governmentOrganizationId", "assignedOrganizationId", "name", "description", "startDate", "createdById", "createdAt", "updatedAt")
SELECT gen_random_uuid(), r.id, r."problemId", r."allocationId", r."governmentOrganizationId", r."assignedOrganizationId",
       left('Resolve: ' || p.title, 200),
       'Resolution project for "' || p.title || '"' || COALESCE(', reported at ' || NULLIF(concat_ws(', ', p.address, p.city), ''), '') || '.',
       (COALESCE(a."acceptedAt", r."createdAt") AT TIME ZONE 'Asia/Kolkata')::date,
       COALESCE(a."respondedById", a."allocatedById"), r."createdAt", now()
FROM resolution_rooms r
JOIN problems p ON p.id = r."problemId"
JOIN problem_allocations a ON a.id = r."allocationId"
WHERE NOT EXISTS (SELECT 1 FROM resolution_projects x WHERE x."roomId" = r.id);
