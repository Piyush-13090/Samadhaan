-- CreateEnum
CREATE TYPE "ExpertiseLevel" AS ENUM ('INTERESTED', 'EXPERIENCED', 'SPECIALIST');

-- NOTE: Prisma proposed `DROP INDEX "problem_embeddings_vector_hnsw"` here and
-- it has been removed deliberately. Prisma has no syntax for HNSW, so it
-- regenerates every diff believing the index should not exist. It is owned by
-- prisma/sql/post-migrate.sql instead. See docs/DATABASE.md §13.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'India',
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "state" TEXT;

-- CreateTable
CREATE TABLE "organization_expertise" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "category" "ProblemCategory" NOT NULL,
    "subcategory" TEXT,
    "level" "ExpertiseLevel" NOT NULL DEFAULT 'EXPERIENCED',
    "addedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_expertise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_expertise_category_level_idx" ON "organization_expertise"("category", "level");

-- CreateIndex
CREATE INDEX "organization_expertise_organizationId_idx" ON "organization_expertise"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_expertise_organizationId_category_key" ON "organization_expertise"("organizationId", "category");

-- AddForeignKey
ALTER TABLE "organization_expertise" ADD CONSTRAINT "organization_expertise_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_expertise" ADD CONSTRAINT "organization_expertise_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Profile field constraints.
--
-- Length caps at the database level as well as in the DTOs: a migration or a
-- psql session bypasses class-validator entirely, and an unbounded bio column
-- is a cheap way for someone to store a megabyte per row.
-- ---------------------------------------------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT "users_bio_length" CHECK ("bio" IS NULL OR length("bio") <= 500),
  ADD CONSTRAINT "users_city_length" CHECK ("city" IS NULL OR length("city") <= 120),
  ADD CONSTRAINT "users_state_length" CHECK ("state" IS NULL OR length("state") <= 120),
  ADD CONSTRAINT "users_country_length"
    CHECK ("country" IS NULL OR length("country") <= 120),
  ADD CONSTRAINT "users_postal_code_length"
    CHECK ("postalCode" IS NULL OR length("postalCode") BETWEEN 3 AND 16);

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_description_length"
    CHECK ("description" IS NULL OR length("description") <= 2000);

ALTER TABLE "organization_expertise"
  ADD CONSTRAINT "organization_expertise_subcategory_length"
    CHECK ("subcategory" IS NULL OR length(trim("subcategory")) BETWEEN 2 AND 80);
