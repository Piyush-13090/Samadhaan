#!/usr/bin/env bash
# Applies prisma/sql/post-migrate.sql — the database objects Prisma cannot
# express. Run after every migration; the file is idempotent.
set -euo pipefail

cd "$(dirname "$0")/.."

# An explicit DATABASE_URL in the environment wins (containers, CI, release
# jobs — Prompt 30). Otherwise the same precedence the API and Prisma config
# use: app-local .env, then root.
if [ -z "${DATABASE_URL:-}" ]; then
  for candidate in .env ../../.env; do
    if [ -f "$candidate" ]; then
      DATABASE_URL="$(grep -E '^DATABASE_URL=' "$candidate" | tail -1 | cut -d= -f2-)"
      [ -n "${DATABASE_URL:-}" ] && break
    fi
  done
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "post-migrate: DATABASE_URL is not set; skipping." >&2
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "post-migrate: psql not found. Apply prisma/sql/post-migrate.sql manually." >&2
  exit 0
fi

# Prisma accepts `?schema=public`; psql rejects it as an unknown URI parameter,
# so strip the query string before connecting.
psql "${DATABASE_URL%%\?*}" -v ON_ERROR_STOP=1 -q -f prisma/sql/post-migrate.sql
echo "post-migrate: applied prisma/sql/post-migrate.sql"
