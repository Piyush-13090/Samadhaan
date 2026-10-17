#!/usr/bin/env bash
# Restarts the benchmark API (port 4100) with optional extra env, e.g.
#   ANALYTICS_CACHE_SECONDS=0 SEARCH_CACHE_SECONDS=0 scripts/perf/restart-perf-api.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
pkill -f "node dist/main.js" || true
sleep 1
nohup scripts/perf/start-perf-api.sh > "${PERF_API_LOG:-/tmp/samadhaan-perf-api.log}" 2>&1 &
for _ in $(seq 1 90); do
  curl -s "http://localhost:${PERF_API_PORT:-4100}/api/v1/health" | grep -q '"success":true' && exit 0
  sleep 1
done
echo "perf API did not start" >&2; exit 1
