-- Runs once, when the PostgreSQL data directory is first initialised.
--
-- Prisma also declares these extensions in its datasource block, so
-- `prisma migrate` keeps them in the migration history for environments that
-- are not provisioned by this script. Creating them here as well means a fresh
-- `docker compose up` has a usable database before any migration runs.

-- Geographic types and indexes: problem locations, radius search, clustering.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Vector similarity: semantic duplicate detection and RAG retrieval.
CREATE EXTENSION IF NOT EXISTS vector;

-- Trigram indexes for fuzzy text matching on problem titles.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
