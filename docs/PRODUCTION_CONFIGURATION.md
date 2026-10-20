# Production Configuration (Prompt 30)

Every variable and its tuning default is listed in `.env.example`.
Production-specific values are in `.env.production.example`. This page covers
what production **must** set, what the services enforce at startup, and how
optional integrations behave when they're absent.

## Environments

| Environment | `NODE_ENV` | Database | Notes |
| --- | --- | --- | --- |
| development | `development` | local `samadhaan` | Seed allowed (`ALLOW_DEV_SEED=true`); `LLM_PROVIDER=development` allowed |
| test (e2e) | `test` (set by Vitest) | the local development database, or a CI database | Caches shortened, sweeps off; never shared with other writers in CI |
| staging | `production` | dedicated | Same images and checks as production; synthetic data and test accounts only |
| production | `production` | dedicated | Everything below enforced |

## Enforced at startup

**API** (`apps/api/src/config/env.schema.ts`, `productionIssues`,
`storageIssues`). The process exits with a list of every problem:

| Check | Rule |
| --- | --- |
| `JWT_ACCESS_SECRET` | ≥ 32 characters, not a placeholder, ≥ 16 distinct characters |
| `AUTH_COOKIE_SECURE` | `true` |
| `AI_SERVICE_TOKEN` | ≥ 32 characters |
| `ALLOW_DEV_SEED` | `false` |
| `CORS_ORIGINS` | explicit `https://` origins, no `*` |
| `PUBLIC_API_URL` | `https://` |
| `REDIS_URL` | `rediss://` or includes a password |
| `STORAGE_PROVIDER` | `s3`; or `local` only with `STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true` |
| `STORAGE_*` (s3, any environment) | bucket, region, access key and secret all present |
| `STORAGE_ENDPOINT` | `https://` when set |
| `LOG_LEVEL` | not `debug` or `trace` |
| `METRICS_TOKEN` | ≥ 32 characters when set |

Verified locally on 2026-10-19: a production start with development values
listed 9 violations and exited; a start with valid values booted.

**AI service** (`services/ai/app/core/config.py`):
- `AI_INTERNAL_TOKEN` must be at least 32 characters;
- `AI_CORS_ORIGINS` must not be `*`;
- `AI_LOG_LEVEL` must not be debug or trace;
- API docs and OpenAPI are disabled.

`LLM_PROVIDER=development` is refused when a provider is built (the first AI
request), not at startup. Analysis then reports "unavailable".

**Not enforced:** `DATABASE_URL` TLS (`sslmode=require`) and the API→AI URL
scheme. These depend on the network design: keep the database and AI service
on a private network, or use TLS.

## Secrets

| Secret | Where | Notes |
| --- | --- | --- |
| `JWT_ACCESS_SECRET` | API | `openssl rand -base64 48`. Rotating it signs every user out within the access-token lifetime (15 min) |
| `AI_SERVICE_TOKEN` (API) = `AI_INTERNAL_TOKEN` (AI) | both | Same value in both services |
| `DATABASE_URL` password | API, migrate job | Use a role that doesn't own `audit_logs` and `impact_point_transactions` and has no TRUNCATE on them (see "Database role" below) |
| `REDIS_URL` password | API | |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | API only | Scope the key to the one bucket: Get, Put, Delete, Head |
| `LLM_API_KEY` | AI service only | Never in the web image or `NEXT_PUBLIC_*` |
| `METRICS_TOKEN` | API, scraper | Optional |

Keep secrets in the platform's secret store, never in images or Git.
`.dockerignore` excludes `.env*`, and CI checks the images. The web bundle
was grepped for secret names (Prompt 30 security audit): no secret values
are present, and only `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_NAME` and
`NEXT_PUBLIC_MAP_*` are exposed.

### Database role

Run the API with a role that can read and write application tables, but that:
- doesn't own `audit_logs` or `impact_point_transactions`;
- has no TRUNCATE on them;
- can't `ALTER` or `DROP` their triggers.

The triggers refuse UPDATE, DELETE and TRUNCATE. But a table owner could
drop them, and any session can set the `samadhaan.audit_maintenance`
switch. Run migrations with a separate owner role.

## Required for production

| Variable | Service | Example |
| --- | --- | --- |
| `NODE_ENV=production` | all | |
| `DATABASE_URL` | API, migrate | `postgresql://app:…@db.internal:5432/samadhaan` |
| `REDIS_URL` | API | `rediss://:…@redis.internal:6380` |
| `AI_SERVICE_URL` | API | `http://ai.internal:8001` |
| `JWT_ACCESS_SECRET`, `AI_SERVICE_TOKEN` | API | generated |
| `AI_INTERNAL_TOKEN` | AI | same as `AI_SERVICE_TOKEN` |
| `AUTH_COOKIE_SECURE=true`, `CORS_ORIGINS`, `PUBLIC_API_URL` | API | `https://app.example.org` |
| `STORAGE_PROVIDER=s3` + `STORAGE_*` | API | |
| `API_INTERNAL_URL` (build arg) | web | `http://api.internal:4000` |

### Recommended

| Variable | Default | Production suggestion |
| --- | --- | --- |
| `DATABASE_POOL_MAX` | 10 | ≤ (`max_connections` − 20) / API replicas; 20 measured better for search fan-out (Prompt 27) |
| `DATABASE_STATEMENT_TIMEOUT_MS` | 0 (off) | 30000 |
| `DATABASE_POOL_ACQUIRE_TIMEOUT_MS` | 10000 | keep |
| `AI_SERVICE_TIMEOUT_MS` | 15000 | keep |
| `LLM_DEADLINE_SECONDS` (AI) | 55 | keep below the API's shortest LLM timeout (60 s) |
| `AI_CIRCUIT_FAILURE_THRESHOLD` / `AI_CIRCUIT_RESET_SECONDS` | 5 / 30 | keep |
| `LOG_LEVEL` | info | info |
| `METRICS_TOKEN` | unset | set, and scrape `/api/v1/metrics` |
| `ML_INFERENCE_ENABLED` | false | false until a model is approved (`MODEL_LIFECYCLE.md`) |

## Optional integrations and fallbacks

| Integration | Needs | Without it |
| --- | --- | --- |
| Anthropic (`LLM_PROVIDER=anthropic`, `LLM_API_KEY`) | API key | Problem analysis, priority AI features, verification AI review, coordinator, knowledge answers, analytics insights and AI query parsing report "unavailable". Reports, comments, allocation, rooms, tasks, evidence, human verification, keyword search and analytics figures all work. |
| Embedding model (local, in the AI image) | nothing external at runtime | — (always available when the AI service is up) |
| AI service down | — | Search falls back to keyword; duplicate detection and analyses are marked FAILED and can be re-run; the circuit breaker fails fast |
| Geocoding (`GEOCODING_PROVIDER`) | provider URL, optional key | Address search is unavailable; picking on the map still works |
| Email (`SMTP_URL`) | — | **Not implemented.** Notifications are in-app only |
| Object storage | bucket and keys | Use local storage on a single host only (explicit flag) |
| Metrics scraper | `METRICS_TOKEN` | `/api/v1/metrics` returns 404; logs and health still work |

## Cookies, CORS, HTTPS

- **Cookies** are `HttpOnly` and `SameSite=Lax`; `Secure` is required in
  production. The refresh cookie is scoped to `/api/v1/auth`.
- **Same origin:** the browser talks to `https://<app>/api/...` through the web
  server, so cookies are first-party and CORS is barely used. `CORS_ORIGINS`
  must still list the app origin, and the CSRF check uses it.
- **HTTPS:** HSTS is sent by both API and web in production. Terminate TLS at
  the proxy or load balancer. `trust proxy` is 1 hop, so put exactly one proxy
  in front of the API.
