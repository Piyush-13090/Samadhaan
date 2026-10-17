#!/usr/bin/env bash
# Recreates the dedicated benchmark database (Prompt 27) and seeds it with
# synthetic data. Refuses to touch any database not named *_perf.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PERF_DATABASE_URL:?Set PERF_DATABASE_URL to a dedicated *_perf database}"
NAME="${PERF_DATABASE_URL##*/}"; NAME="${NAME%%\?*}"
case "$NAME" in *_perf) ;; *) echo "Refusing: '$NAME' is not a *_perf database" >&2; exit 1;; esac
ADMIN="${PERF_DATABASE_URL%/*}/postgres"
psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS \"$NAME\"" -c "CREATE DATABASE \"$NAME\""
psql "$PERF_DATABASE_URL" -q -c "CREATE EXTENSION postgis; CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;"
DATABASE_URL="$PERF_DATABASE_URL" npx prisma migrate deploy >/dev/null
psql "$PERF_DATABASE_URL" -q -f prisma/sql/post-migrate.sql 2>&1 | grep -v NOTICE || true
: "${PERF_PASSWORD_HASH:?Set PERF_PASSWORD_HASH to an argon2 hash for the synthetic accounts}"
psql "$PERF_DATABASE_URL" -q -v pwhash="'$PERF_PASSWORD_HASH'" -f scripts/perf/seed-perf.sql 2>&1 | grep -v NOTICE || true
echo "perf database $NAME ready"
