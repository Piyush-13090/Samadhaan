# Operations Runbook (Prompt 30)

Day-to-day operation and diagnosis. For restoring from backups, migration
failures and outage recovery, see [RECOVERY_RUNBOOK.md](./RECOVERY_RUNBOOK.md).
For security incidents, see [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md).

## Health endpoints

| Endpoint | Service | Meaning | Use for |
| --- | --- | --- | --- |
| `GET /api/v1/health/live` | API | Process is up (no dependencies checked) | Container liveness / restart |
| `GET /api/v1/health` | API | 200 `ok` or `degraded` (Redis or AI down); **503** when PostgreSQL is down | Load-balancer readiness |
| `GET /health/live` | AI | Process is up | Liveness |
| `GET /health` | AI | 503 only when it can't serve at all; reports provider and model state | Readiness, diagnostics |
| `GET /api/v1/metrics` | API | Prometheus text (Bearer `METRICS_TOKEN`) | Scraping |

## Metrics (API, `/api/v1/metrics`)

| Metric | Labels | Watch for |
| --- | --- | --- |
| `samadhaan_http_requests_total` | method, route template, status class | 5xx rate > 1% over 5 min |
| `samadhaan_http_request_duration_seconds` | method, route template | p95 over the targets in `PERFORMANCE_AUDIT.md` |
| `samadhaan_ai_requests_total` | group, outcome (ok, client_error, server_error, timeout, unreachable, circuit_open) | rising `timeout`/`unreachable`; any `circuit_open` |
| `samadhaan_ai_circuit_state` | group (0 closed, 1 half-open, 2 open) | 2 for more than a few minutes |
| `samadhaan_background_job_runs_total` | job (priority_sweep, impact_reconcile, coordinator_sweep), outcome | `failed`; or no `completed` for an hour |
| `samadhaan_storage_errors_total` | operation | any increase |
| `samadhaan_process_resident_memory_bytes`, `_uptime_seconds` | — | memory growth; restarts |

Metrics are per process: aggregate across replicas in the scraper. Labels
never contain ids, URLs with parameters or user data.

## Logs

- **API:** pino JSON. Each request logs method, path (no query string),
  status, `responseTime` (ms) and request id. Cookies, authorisation headers
  and passwords are redacted.
- **AI service:** structlog JSON with the same `request_id`. It logs task,
  version, outcome and latency, never prompts or citizen text.

Every error response carries the request id. Search all services for it.

## Diagnosing

| Symptom | Check | Likely cause and action |
| --- | --- | --- |
| **API 5xx** | 5xx rate by route; logs for the request id; `GET /api/v1/health` | DB errors → see below. Uncaught exceptions log a stack (never sent to clients). |
| **Database connectivity** | Readiness 503 with `database: down`; logs `Initial database connection failed` / pool timeouts after `DATABASE_POOL_ACQUIRE_TIMEOUT_MS` | Network or credentials; `max_connections` exhausted (replicas × pool). Requests fail fast; sweeps resume after recovery. |
| **Redis outage** | Readiness `redis: degraded` | The API keeps serving. Login limits fall back to per-process memory, and the user-level limiters fail open. Caches miss; the coordinator sweep pauses. Restore Redis; nothing to replay. |
| **AI provider errors** | `samadhaan_ai_requests_total{outcome="server_error"}`; AI logs `provider_*`; analyses FAILED | Key invalid (non-retryable), rate-limited (`RATE_LIMITED`, retryable), timeouts (deadline). Fix the key or quota; re-run analyses from the report page or `POST /problems/:id/analyze`. |
| **AI service down or hung** | `ai_circuit_state=2`; readiness `aiService: degraded` | Restart the AI container; check memory (the model needs ~1 GB). The breaker closes after one successful trial. |
| **Stuck background jobs** | `background_job_runs_total`; logs `… sweep failed`; Redis keys `*:lock` | A crashed holder leaves a lock until its TTL (15–30 min); it then frees itself. Sweeps are idempotent. Stuck evidence analyses are reset by `recover()` on the next verification sweep. |
| **Failed uploads** | 4xx: client (type, size, content). 5xx plus `storage_errors_total` | Bucket permissions or credentials (`AccessDenied`), endpoint reachability. Missing objects return 404, never 500. |
| **Migration failure** | Migrate job exit code; `prisma migrate status` | See RECOVERY_RUNBOOK.md (Migrations). Don't start the new API version until it's resolved. |
| **High latency** | Duration histogram by route; DB slow-query log; AI timeouts | Pool saturation (raise `DATABASE_POOL_MAX` within `max_connections`); HNSW index not memory-resident (`SCALABILITY_GUIDE.md`); AI slowness (breaker, deadline). |
| **Authentication problems** | 401 vs 403 vs 429 on `/auth/*`; `ACCOUNT_INACTIVE` code | Expired session (refresh rotates; a reused refresh token revokes all sessions, by design). Suspended account (403). Rate limited (429, `retry-after`). Cookies need HTTPS with `AUTH_COOKIE_SECURE=true`. Clock skew affects JWT expiry. |

## Routine tasks

| Task | How |
| --- | --- |
| Deploy | `DEPLOYMENT_GUIDE.md`, "Deploy" |
| Activate or roll back a model | `MODEL_LIFECYCLE.md` (ADMIN API; nothing is automatic) |
| Turn off all registry-model inference | `ML_INFERENCE_ENABLED=false` |
| Inspect inference health | `GET /api/v1/admin/ml/monitoring?task=…` |
| Load test before scaling | `apps/api/scripts/perf/load-test.mjs` against a `*_perf` copy |
| Archive smoke-test reports | Search for `[SMOKE TEST` titles in staging |
