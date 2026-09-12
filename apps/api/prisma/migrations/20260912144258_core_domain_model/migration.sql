-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('NGO', 'UNIVERSITY', 'INDUSTRY', 'GOVERNMENT');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrganizationMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'LEFT');

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'DUPLICATE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProblemSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ProblemUrgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ProblemCategory" AS ENUM ('ROADS', 'POTHOLES', 'STREETLIGHTS', 'WATER', 'DRAINAGE', 'SANITATION', 'GARBAGE', 'TRAFFIC', 'PUBLIC_SAFETY', 'POLLUTION', 'ELECTRICITY', 'PUBLIC_TRANSPORT', 'PARKS', 'PUBLIC_INFRASTRUCTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProblemImageKind" AS ENUM ('BEFORE', 'PROGRESS', 'AFTER', 'EVIDENCE');

-- CreateEnum
CREATE TYPE "AnalysisType" AS ENUM ('INITIAL_ANALYSIS', 'REANALYSIS', 'DUPLICATE_ANALYSIS', 'SEVERITY_ANALYSIS', 'VERIFICATION_ANALYSIS');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmbeddingType" AS ENUM ('TEXT', 'IMAGE', 'MULTIMODAL');

-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('PENDING', 'LIKELY_DUPLICATE', 'NOT_DUPLICATE', 'CONFIRMED_DUPLICATE', 'REJECTED');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'REVIEWED', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "revokedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "lastUsedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bio" TEXT,
ALTER COLUMN "emailVerifiedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "lastLoginAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "websiteUrl" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'India',
    "postalCode" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "location" geography(Point, 4326),
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "membershipRole" "OrganizationMemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "joinedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problems" (
    "id" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "reporterId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ProblemCategory" NOT NULL,
    "subcategory" TEXT,
    "status" "ProblemStatus" NOT NULL DEFAULT 'DRAFT',
    "severity" "ProblemSeverity" NOT NULL DEFAULT 'MEDIUM',
    "urgency" "ProblemUrgency" NOT NULL DEFAULT 'MEDIUM',
    "priorityScore" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'India',
    "postalCode" TEXT,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "location" geography(Point, 4326),
    "locationAccuracyM" INTEGER,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "followCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateOfId" UUID,
    "submittedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_images" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT,
    "originalFileName" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "kind" "ProblemImageKind" NOT NULL DEFAULT 'BEFORE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "perceptualHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "problem_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_ai_analyses" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "analysisType" "AnalysisType" NOT NULL,
    "category" "ProblemCategory",
    "subcategory" TEXT,
    "severity" "ProblemSeverity",
    "urgency" "ProblemUrgency",
    "severityScore" DECIMAL(4,2),
    "summary" TEXT,
    "confidence" DECIMAL(5,4),
    "rawResult" JSONB,
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "processingMs" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "problem_ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_embeddings" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "embeddingType" "EmbeddingType" NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL DEFAULT 1536,
    "embedding" vector(1536),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problem_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_duplicate_candidates" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "candidateProblemId" UUID NOT NULL,
    "textSimilarity" DECIMAL(5,4),
    "imageSimilarity" DECIMAL(5,4),
    "geographicSimilarity" DECIMAL(5,4),
    "categorySimilarity" DECIMAL(5,4),
    "combinedScore" DECIMAL(5,4),
    "confidence" DECIMAL(5,4),
    "status" "DuplicateStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "problem_duplicate_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_votes" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problem_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_follows" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problem_follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_comments" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "parentCommentId" UUID,
    "body" TEXT NOT NULL,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "problem_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_suggestions" (
    "id" UUID NOT NULL,
    "problemId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "organizationId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "endorsementCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "problem_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_type_verificationStatus_idx" ON "organizations"("type", "verificationStatus");

-- CreateIndex
CREATE INDEX "organizations_verificationStatus_idx" ON "organizations"("verificationStatus");

-- CreateIndex
CREATE INDEX "organizations_state_city_idx" ON "organizations"("state", "city");

-- CreateIndex
CREATE INDEX "organizations_deletedAt_idx" ON "organizations"("deletedAt");

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "organization_members"("userId");

-- CreateIndex
CREATE INDEX "organization_members_organizationId_status_idx" ON "organization_members"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON "organization_members"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "problems_publicId_key" ON "problems"("publicId");

-- CreateIndex
CREATE INDEX "problems_status_createdAt_idx" ON "problems"("status", "createdAt");

-- CreateIndex
CREATE INDEX "problems_category_status_idx" ON "problems"("category", "status");

-- CreateIndex
CREATE INDEX "problems_status_priorityScore_idx" ON "problems"("status", "priorityScore");

-- CreateIndex
CREATE INDEX "problems_reporterId_createdAt_idx" ON "problems"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "problems_state_city_status_idx" ON "problems"("state", "city", "status");

-- CreateIndex
CREATE INDEX "problems_severity_urgency_idx" ON "problems"("severity", "urgency");

-- CreateIndex
CREATE INDEX "problems_deletedAt_idx" ON "problems"("deletedAt");

-- CreateIndex
CREATE INDEX "problems_duplicateOfId_idx" ON "problems"("duplicateOfId");

-- CreateIndex
CREATE UNIQUE INDEX "problem_images_storageKey_key" ON "problem_images"("storageKey");

-- CreateIndex
CREATE INDEX "problem_images_problemId_sortOrder_idx" ON "problem_images"("problemId", "sortOrder");

-- CreateIndex
CREATE INDEX "problem_images_problemId_kind_idx" ON "problem_images"("problemId", "kind");

-- CreateIndex
CREATE INDEX "problem_ai_analyses_problemId_analysisType_createdAt_idx" ON "problem_ai_analyses"("problemId", "analysisType", "createdAt");

-- CreateIndex
CREATE INDEX "problem_ai_analyses_processingStatus_createdAt_idx" ON "problem_ai_analyses"("processingStatus", "createdAt");

-- CreateIndex
CREATE INDEX "problem_embeddings_embeddingType_idx" ON "problem_embeddings"("embeddingType");

-- CreateIndex
CREATE UNIQUE INDEX "problem_embeddings_problemId_embeddingType_modelName_key" ON "problem_embeddings"("problemId", "embeddingType", "modelName");

-- CreateIndex
CREATE INDEX "problem_duplicate_candidates_candidateProblemId_idx" ON "problem_duplicate_candidates"("candidateProblemId");

-- CreateIndex
CREATE INDEX "problem_duplicate_candidates_status_combinedScore_idx" ON "problem_duplicate_candidates"("status", "combinedScore");

-- CreateIndex
CREATE UNIQUE INDEX "problem_duplicate_candidates_problemId_candidateProblemId_key" ON "problem_duplicate_candidates"("problemId", "candidateProblemId");

-- CreateIndex
CREATE INDEX "problem_votes_userId_createdAt_idx" ON "problem_votes"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "problem_votes_problemId_userId_key" ON "problem_votes"("problemId", "userId");

-- CreateIndex
CREATE INDEX "problem_follows_userId_createdAt_idx" ON "problem_follows"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "problem_follows_problemId_userId_key" ON "problem_follows"("problemId", "userId");

-- CreateIndex
CREATE INDEX "problem_comments_problemId_createdAt_idx" ON "problem_comments"("problemId", "createdAt");

-- CreateIndex
CREATE INDEX "problem_comments_parentCommentId_idx" ON "problem_comments"("parentCommentId");

-- CreateIndex
CREATE INDEX "problem_comments_userId_createdAt_idx" ON "problem_comments"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "problem_suggestions_problemId_status_idx" ON "problem_suggestions"("problemId", "status");

-- CreateIndex
CREATE INDEX "problem_suggestions_authorId_createdAt_idx" ON "problem_suggestions"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "problem_suggestions_organizationId_idx" ON "problem_suggestions"("organizationId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problems" ADD CONSTRAINT "problems_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problems" ADD CONSTRAINT "problems_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_images" ADD CONSTRAINT "problem_images_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_ai_analyses" ADD CONSTRAINT "problem_ai_analyses_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_embeddings" ADD CONSTRAINT "problem_embeddings_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_duplicate_candidates" ADD CONSTRAINT "problem_duplicate_candidates_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_duplicate_candidates" ADD CONSTRAINT "problem_duplicate_candidates_candidateProblemId_fkey" FOREIGN KEY ("candidateProblemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_duplicate_candidates" ADD CONSTRAINT "problem_duplicate_candidates_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_votes" ADD CONSTRAINT "problem_votes_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_votes" ADD CONSTRAINT "problem_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_follows" ADD CONSTRAINT "problem_follows_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_follows" ADD CONSTRAINT "problem_follows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_comments" ADD CONSTRAINT "problem_comments_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_comments" ADD CONSTRAINT "problem_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_comments" ADD CONSTRAINT "problem_comments_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "problem_comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_suggestions" ADD CONSTRAINT "problem_suggestions_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_suggestions" ADD CONSTRAINT "problem_suggestions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_suggestions" ADD CONSTRAINT "problem_suggestions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_suggestions" ADD CONSTRAINT "problem_suggestions_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- RAW SQL — features Prisma's schema language cannot express.
--
-- Everything below is reproducible from an empty database: this file runs in
-- order after the generated DDL above.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Human-readable problem identifiers (SAM-1023, SAM-1024, …)
--
-- A PostgreSQL sequence, not application code. `nextval()` is atomic and never
-- returns the same value twice even under concurrent inserts, so two citizens
-- reporting simultaneously cannot collide. Generating the number in Node would
-- require a read-then-write, which is exactly the race this avoids.
--
-- Starting at 1000 so the first identifiers are four digits and the format
-- stays stable, rather than SAM-1 growing to SAM-1000 later.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS problem_public_id_seq START WITH 1000 INCREMENT BY 1;

ALTER TABLE "problems"
  ALTER COLUMN "publicId" SET DEFAULT 'SAM-' || nextval('problem_public_id_seq');

-- The sequence exists only to feed this column; drop it with the table.
ALTER SEQUENCE problem_public_id_seq OWNED BY "problems"."publicId";

-- ---------------------------------------------------------------------------
-- 2. PostGIS location, derived from latitude/longitude
--
-- `latitude`/`longitude` are the writable source of truth — Prisma can write
-- them, and they are what an API request carries. `location` is maintained by
-- this trigger so the two can never disagree, which they would if application
-- code were responsible for setting both.
--
-- A trigger rather than a generated column because Prisma's migration engine
-- does not model generated columns and would report drift against them
-- forever; triggers are invisible to it.
--
-- Note the argument order: ST_MakePoint takes (longitude, latitude). Reversing
-- them is the classic PostGIS bug — it silently produces a point in the wrong
-- hemisphere rather than an error.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_location_from_lat_lng()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
    NEW.location := NULL;
  ELSE
    NEW.location := ST_SetSRID(
      ST_MakePoint(NEW.longitude::double precision, NEW.latitude::double precision),
      4326
    )::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER problems_location_sync
  BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "problems"
  FOR EACH ROW EXECUTE FUNCTION sync_location_from_lat_lng();

CREATE TRIGGER organizations_location_sync
  BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION sync_location_from_lat_lng();

-- ---------------------------------------------------------------------------
-- 3. Spatial indexes
--
-- GiST, not B-tree. A B-tree on latitude and longitude cannot answer "within
-- 2 km of here" — it would scan one dimension and filter the rest. GiST on the
-- geography column is what makes radius search and clustering tractable, and
-- those are the core map queries.
-- ---------------------------------------------------------------------------
CREATE INDEX "problems_location_gist" ON "problems" USING GIST ("location");
CREATE INDEX "organizations_location_gist" ON "organizations" USING GIST ("location");

-- No composite (category, location) GiST index. A GiST index over an enum
-- needs the btree_gist extension, and it would buy little: the spatial index
-- narrows to a geographically local candidate set first, after which filtering
-- by category is trivial. One fewer extension to keep in sync across
-- init.sql, the Prisma datasource and every environment.

-- ---------------------------------------------------------------------------
-- 4. Trigram index for fuzzy title matching
--
-- Complements vector search: embeddings catch "waterlogging" ≈ "flooding",
-- trigrams catch "Sector 12" ≈ "Sector-12". Duplicate detection uses both.
-- ---------------------------------------------------------------------------
CREATE INDEX "problems_title_trgm" ON "problems" USING GIN ("title" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 5. Vector index
--
-- HNSW rather than IVFFlat: it needs no training pass over existing data, so it
-- works on an empty table and stays correct as rows are added — which matters
-- for a corpus that grows continuously from zero.
--
-- `vector_cosine_ops` because the embedding models produce normalised vectors
-- and cosine is the similarity they are trained for. Building this on an empty
-- table is cheap; building it after a million rows is not.
-- ---------------------------------------------------------------------------
CREATE INDEX "problem_embeddings_vector_hnsw"
  ON "problem_embeddings" USING hnsw ("embedding" vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- 6. Partial unique index: one primary image per problem
--
-- A plain unique on (problemId, isPrimary) would also forbid a second
-- non-primary image. The WHERE clause constrains only the rows that matter.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "problem_images_one_primary_per_problem"
  ON "problem_images" ("problemId")
  WHERE "isPrimary" = true;

-- ---------------------------------------------------------------------------
-- 7. CHECK constraints
--
-- Application validation is the first line, not the only one. These hold even
-- when a row arrives from a migration, a script, or a psql session — the paths
-- that bypass the API entirely.
-- ---------------------------------------------------------------------------

-- Coordinates must be on Earth.
ALTER TABLE "problems"
  ADD CONSTRAINT "problems_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "problems_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "problems_priority_score_non_negative" CHECK ("priorityScore" >= 0),
  -- Denormalised counters are maintained by application code; a negative value
  -- means that code has a bug, and failing loudly beats a wrong feed ordering.
  ADD CONSTRAINT "problems_counts_non_negative"
    CHECK ("voteCount" >= 0 AND "commentCount" >= 0 AND "followCount" >= 0),
  -- A problem cannot duplicate itself.
  ADD CONSTRAINT "problems_no_self_duplicate"
    CHECK ("duplicateOfId" IS NULL OR "duplicateOfId" <> "id");

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_latitude_range"
    CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "organizations_longitude_range"
    CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180),
  -- Slugs appear in URLs; enforce the shape rather than trusting every writer.
  ADD CONSTRAINT "organizations_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "problem_images"
  ADD CONSTRAINT "problem_images_file_size_positive" CHECK ("fileSize" > 0),
  ADD CONSTRAINT "problem_images_dimensions_positive"
    CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0));

ALTER TABLE "problem_ai_analyses"
  ADD CONSTRAINT "problem_ai_analyses_confidence_range"
    CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1),
  ADD CONSTRAINT "problem_ai_analyses_severity_score_range"
    CHECK ("severityScore" IS NULL OR "severityScore" BETWEEN 0 AND 10);

-- Every similarity signal is a 0–1 fraction. A value outside that range means
-- a scoring bug, and storing it would silently corrupt threshold tuning.
ALTER TABLE "problem_duplicate_candidates"
  ADD CONSTRAINT "problem_duplicate_candidates_no_self_reference"
    CHECK ("problemId" <> "candidateProblemId"),
  ADD CONSTRAINT "problem_duplicate_candidates_scores_range" CHECK (
    ("textSimilarity" IS NULL OR "textSimilarity" BETWEEN 0 AND 1) AND
    ("imageSimilarity" IS NULL OR "imageSimilarity" BETWEEN 0 AND 1) AND
    ("geographicSimilarity" IS NULL OR "geographicSimilarity" BETWEEN 0 AND 1) AND
    ("categorySimilarity" IS NULL OR "categorySimilarity" BETWEEN 0 AND 1) AND
    ("combinedScore" IS NULL OR "combinedScore" BETWEEN 0 AND 1) AND
    ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1)
  );

ALTER TABLE "problem_embeddings"
  ADD CONSTRAINT "problem_embeddings_dimensions_positive" CHECK ("dimensions" > 0);

ALTER TABLE "problem_comments"
  -- A comment cannot be its own parent. Deeper cycles are prevented in
  -- application code; a CHECK cannot express reachability.
  ADD CONSTRAINT "problem_comments_no_self_parent"
    CHECK ("parentCommentId" IS NULL OR "parentCommentId" <> "id"),
  ADD CONSTRAINT "problem_comments_body_not_empty" CHECK (length(trim("body")) > 0);

ALTER TABLE "problem_suggestions"
  ADD CONSTRAINT "problem_suggestions_endorsements_non_negative"
    CHECK ("endorsementCount" >= 0);
