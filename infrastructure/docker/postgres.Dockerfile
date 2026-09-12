# PostgreSQL 16 with both extensions Samadhaan depends on.
#
# The official postgis image already carries PostGIS and has the PGDG apt
# repository configured, so pgvector is a single package install on top of it.
# Building this rather than pulling a prebuilt "everything" image keeps the
# extension versions explicit and auditable.
FROM postgis/postgis:16-3.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
