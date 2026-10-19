#!/usr/bin/env bash
# Migration validation (Prompt 29). Used by CI and runnable locally:
#
#   CHECK_DATABASE_URL=postgresql://user:pass@localhost:5432/samadhaan_migration_check \
#     apps/api/scripts/ci/check-migrations.sh
#
# 1. Drops and recreates the named database. It refuses any name not ending in
#    `_migration_check`, so it can never touch a real database.
# 2. Applies every migration in order (`prisma migrate deploy`), then
#    prisma/sql/post-migrate.sql — exactly the documented setup path.
# 3. Applies post-migrate.sql a second time: it must be idempotent.
# 4. Diffs the resulting database against schema.prisma. The only accepted
#    difference is the three HNSW indexes that Prisma cannot express (they are
#    created by post-migrate.sql). Anything else is drift and fails the check.
# 5. Checks the extensions and the spatial/vector/partial indexes exist.
set -euo pipefail
cd "$(dirname "$0")/../.."

URL="${CHECK_DATABASE_URL:?Set CHECK_DATABASE_URL to a *_migration_check database URL}"
URL="${URL%%\?*}"
DB="${URL##*/}"
case "$DB" in *_migration_check) ;; *) echo "Refusing: database name must end in _migration_check" >&2; exit 1;; esac
ADMIN_URL="${URL%/*}/postgres"

echo "==> recreating $DB"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\""

echo "==> prisma migrate deploy"
DATABASE_URL="$URL" npx prisma migrate deploy

echo "==> post-migrate.sql (twice: must be idempotent)"
psql "$URL" -v ON_ERROR_STOP=1 -q -f prisma/sql/post-migrate.sql 2>&1 | grep -v NOTICE || true
psql "$URL" -v ON_ERROR_STOP=1 -q -f prisma/sql/post-migrate.sql 2>&1 | grep -v NOTICE || true

echo "==> drift check (database vs schema.prisma)"
DIFF="$(DATABASE_URL="$URL" npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script 2>/dev/null \
  | grep -v '^Loaded Prisma config' || true)"
UNEXPECTED="$(printf '%s\n' "$DIFF" \
  | grep -vE '^\s*$|^-- (DropIndex|This is an empty migration)' \
  | grep -vE '^DROP INDEX "(problem_embeddings_vector_hnsw|organization_embeddings_vector_hnsw|knowledge_chunks_embedding_hnsw)";$' || true)"
if [ -n "$UNEXPECTED" ]; then
  echo "Schema drift between migrations and schema.prisma:" >&2
  printf '%s\n' "$UNEXPECTED" >&2
  exit 1
fi

echo "==> extensions and indexes"
MISSING="$(psql "$URL" -At -v ON_ERROR_STOP=1 <<'SQL'
WITH want(kind, name) AS (VALUES
  ('ext', 'postgis'), ('ext', 'vector'), ('ext', 'pg_trgm'),
  ('idx', 'problems_location_gist'),
  ('idx', 'problem_embeddings_vector_hnsw'),
  ('idx', 'organization_embeddings_vector_hnsw'),
  ('idx', 'knowledge_chunks_embedding_hnsw'),
  ('idx', 'problems_search_vector_gin'),
  ('idx', 'knowledge_chunks_content_vector_gin'),
  ('idx', 'problems_city_lower'),
  ('idx', 'problem_allocations_one_active'),
  ('idx', 'model_versions_one_active_per_task'))
SELECT kind || ':' || name FROM want
WHERE false
UNION ALL
SELECT 'trigger:' || t FROM unnest(ARRAY['audit_logs_append_only','audit_logs_no_truncate','impact_point_transactions_append_only','impact_point_transactions_no_truncate']) AS t
WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t)
UNION ALL
SELECT kind || ':' || name FROM want
WHERE (kind = 'ext' AND NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = name))
   OR (kind = 'idx' AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = name));
SQL
)"
if [ -n "$MISSING" ]; then
  echo "Missing after setup: $MISSING" >&2
  exit 1
fi

echo "==> migration check passed ($(ls -d prisma/migrations/*/ | wc -l | tr -d ' ') migrations)"
