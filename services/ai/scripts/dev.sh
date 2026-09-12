#!/usr/bin/env bash
# Starts the AI service in development with hot reload.
# Creates the virtualenv and installs dependencies on first run.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d .venv ]; then
  echo "Creating virtualenv..."
  python3 -m venv .venv
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements-dev.txt
fi

PORT="${AI_PORT:-8000}"
HOST="${AI_HOST:-0.0.0.0}"

exec ./.venv/bin/uvicorn app.main:app --reload --host "$HOST" --port "$PORT"
