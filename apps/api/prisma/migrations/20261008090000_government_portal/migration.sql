-- Government portal (Prompt 15): jurisdiction on organisations, private
-- internal review notes, and an append-only audit log.
--
-- NOTE: Prisma proposed DROP INDEX for both HNSW vector indexes here; removed
-- deliberately, as in earlier migrations — Prisma cannot express HNSW.

-- CreateEnum
CREATE TYPE "JurisdictionType" AS ENUM ('MUNICIPAL_CORPORATION', 'MUNICIPALITY', 'DISTRICT_ADMINISTRATION', 'URBAN_LOCAL_BODY', 'GOVERNMENT_DEPARTMENT', 'PUBLIC_AUTHORITY');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('INTERNAL');

-- DropIndex
DROP INDEX "problem_embeddings_vector_hnsw";

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "jurisdictionBoundary" geography(MultiPolygon, 4326),
ADD COLUMN     "jurisdictionCities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "jurisdictionName" TEXT,
ADD COLUMN     "jurisdictionPostalCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "jurisdictionType" "JurisdictionType";

-- CreateTable
CREATE TABLE "problem_internal_notes" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problem_internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "problem_internal_notes_problemId_organizationId_createdAt_idx" ON "problem_internal_notes"("problemId", "organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "organizations_jurisdiction_gist" ON "organizations" USING GIST ("jurisdictionBoundary");

-- AddForeignKey
ALTER TABLE "problem_internal_notes" ADD CONSTRAINT "problem_internal_notes_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_internal_notes" ADD CONSTRAINT "problem_internal_notes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_internal_notes" ADD CONSTRAINT "problem_internal_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- audit_logs is append-only.
--
-- An audit trail that can be edited is not evidence. Inserts are allowed;
-- updates and deletes are refused at the database, so no code path — present
-- or future, ORM or raw SQL — can rewrite history.
--
-- Two exceptions, both explicit:
--  * the foreign key's own ON DELETE SET NULL, when an actor's account is
--    removed: only "actorUserId" changes, to NULL, and nothing else may;
--  * a maintenance session that sets `samadhaan.audit_maintenance = on` for
--    its transaction (test clean-up, data-protection erasure). It is a
--    deliberate act, never something application requests do.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('samadhaan.audit_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD."actorUserId" IS NOT NULL AND NEW."actorUserId" IS NULL
     AND NEW."id" = OLD."id"
     AND NEW."action" = OLD."action"
     AND NEW."entityType" = OLD."entityType"
     AND NEW."entityId" IS NOT DISTINCT FROM OLD."entityId"
     AND NEW."metadata" IS NOT DISTINCT FROM OLD."metadata"
     AND NEW."ipAddress" IS NOT DISTINCT FROM OLD."ipAddress"
     AND NEW."userAgent" IS NOT DISTINCT FROM OLD."userAgent"
     AND NEW."createdAt" = OLD."createdAt" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_logs is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

-- Government reads of activity: "audit entries for these problems, newest
-- first" is served by the existing (entityType, entityId, createdAt) index.
