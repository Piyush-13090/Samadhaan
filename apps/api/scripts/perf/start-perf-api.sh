#!/usr/bin/env bash
# Starts a benchmark instance of the API (Prompt 27) on port 4100 against the
# dedicated *_perf database and a separate Redis logical database, with
# background sweeps off (they would otherwise embed the whole synthetic
# corpus through the AI service) and request logging at warn, as production
# would run. Uses the compiled build: run `npm run build` first.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PERF_DATABASE_URL:?Set PERF_DATABASE_URL}"
case "${PERF_DATABASE_URL%%\?*}" in *_perf) ;; *) echo "Refusing: not a *_perf database" >&2; exit 1;; esac
export DATABASE_URL="$PERF_DATABASE_URL"
export REDIS_URL="${PERF_REDIS_URL:-redis://localhost:6379/5}"
export API_PORT="${PERF_API_PORT:-4100}"
export LOG_LEVEL="${PERF_LOG_LEVEL:-warn}"
export MATCHING_SWEEP_ON_STARTUP=false PRIORITY_SWEEP_ON_STARTUP=false PRIORITY_SCHEDULE_MINUTES=0
export IMPACT_RECONCILE_ON_STARTUP=false IMPACT_RECONCILE_MINUTES=0 VERIFICATION_SWEEP_ON_STARTUP=false
export COORDINATOR_ENABLED=false RAG_SWEEP_ON_STARTUP=false
exec node dist/main.js
