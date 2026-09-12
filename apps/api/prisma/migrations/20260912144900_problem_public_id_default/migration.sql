-- Aligns the `publicId` default with the form Prisma now generates from
-- `@default(dbgenerated(...))` in the schema.
--
-- Functionally identical to the default set in the core_domain_model migration;
-- restating it here means the schema, not the raw SQL, is the source of truth,
-- so `prisma migrate dev` no longer proposes changing it on every run.
ALTER TABLE "problems"
  ALTER COLUMN "publicId" SET DEFAULT ('SAM-' || nextval('problem_public_id_seq'));
