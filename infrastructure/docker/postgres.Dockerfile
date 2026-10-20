# PostgreSQL 16 with both extensions Samadhaan depends on.
#
# The official postgis image already carries PostGIS and has the PGDG apt
# repository configured, so pgvector is a single package install on top of it.
# Building this rather than pulling a prebuilt "everything" image keeps the
# extension versions explicit and auditable.
#
# Base: PostgreSQL 16 with PostGIS 3.6 on Debian 13 (trixie). The previous
# base, 16-3.4, is built on Debian 11 (bullseye) and hasn't been updated since
# 2024. PGDG removed bullseye-pgdg from apt.postgresql.org (the Release file
# returns 404), so `apt-get update` failed. PostGIS 3.6.4 is also what local
# development runs.
FROM postgis/postgis:16-3.6

# pgvector 0.8.x: search and RAG set hnsw.iterative_scan, which needs 0.8.
RUN apt-get update \
    && apt-get install -y --no-install-recommends 'postgresql-16-pgvector=0.8.*' \
    && rm -rf /var/lib/apt/lists/*
