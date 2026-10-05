-- Community engagement: support, follow and threaded comments (Prompt 10).
--
-- The community tables already exist from the core domain model. This adds
-- only what the feature genuinely needed and the schema did not have.

-- "Recently discussed" discovery. Maintained transactionally with comment
-- inserts; see the column comment in schema.prisma.
ALTER TABLE "problems" ADD COLUMN "lastCommentAt" TIMESTAMPTZ(3);

CREATE INDEX "problems_lastCommentAt_idx" ON "problems"("lastCommentAt" DESC);

-- Replies are read in order per parent. The bare parent index found them and
-- then sorted; the composite answers the query directly.
DROP INDEX "problem_comments_parentCommentId_idx";
CREATE INDEX "problem_comments_parentCommentId_createdAt_idx"
  ON "problem_comments"("parentCommentId", "createdAt");

-- Backfill from existing comments so "recently discussed" is right immediately.
UPDATE "problems" p
SET "lastCommentAt" = c."latest"
FROM (
  SELECT "problemId", MAX("createdAt") AS "latest"
  FROM "problem_comments"
  GROUP BY "problemId"
) c
WHERE c."problemId" = p."id";

-- ---------------------------------------------------------------------------
-- Integrity the API also enforces, held in the database so no future code
-- path — a script, an admin tool, a bug — can bypass it.
-- ---------------------------------------------------------------------------

-- Matches COMMENT_BODY_MAX_LENGTH in @samadhaan/shared. Non-blank, bounded.
ALTER TABLE "problem_comments"
  ADD CONSTRAINT "problem_comments_body_length"
    CHECK (length(btrim("body")) BETWEEN 1 AND 2000);

-- A comment cannot be its own parent.
ALTER TABLE "problem_comments"
  ADD CONSTRAINT "problem_comments_not_self_parent"
    CHECK ("parentCommentId" IS NULL OR "parentCommentId" <> "id");
