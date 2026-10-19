# Staging Preflight

The checklist to clear before, and while, deploying Samadhaan to staging for
the first time. Results are from the preflight audit of 2026-10-19 on branch
`release/staging-candidate`. Nothing has been pushed or deployed.

Status key: **PASS** verified with the command shown · **FAIL** verified
broken · **NOT RUN** not executed (the reason is given) · **DECISION** waits
on the owner.

**Overall: NO-GO for deploying staging.** One functional blocker (B1) and the
unrun CI pipeline (B2) must be cleared first. The code otherwise passes every
local gate.

## Blockers

| # | Blocker | Evidence | Owner | To clear |
| - | --- | --- | --- | --- |
| B1 | **Self-registration is broken.** `POST /auth/register` creates the user as `PENDING_VERIFICATION`. Since Prompt 26 (`4973322`), the access-token guard (`SessionService.findActive`) accepts only `ACTIVE` users, and nothing can activate an account: there is no email verification, no endpoint and no admin action. A new citizen gets 201 on register and then 401 on every authenticated request. Tests and the smoke script miss it because they create ACTIVE users directly. | Development API, 2026-10-19: register 201, then `/auth/me` 401 and `/users/me` 401. `prisma/schema.prisma` `status @default(PENDING_VERIFICATION)`; `session.service.ts` `status !== 'ACTIVE'`. | Owner (product), then engineering | Decide: (a) create users ACTIVE until email verification exists; (b) let `PENDING_VERIFICATION` authenticate as `rotate()` already does, keeping a separate gate for privileged actions; or (c) build email verification (needs SMTP). Add an e2e test that registers and then uses the session, and a smoke step for it. |
| B2 | **CI has never run.** It includes the Docker image builds, image checks, gitleaks and the compose validation, none of which have run anywhere. | No Docker or `gh` on the release machine. | Operator | Push the branch and open a PR to `main` (§ Push and CI). All five jobs green. |
| B3 | **No staging environment.** No provider, region or budget chosen. | — | Owner | § Infrastructure decisions. |
| B4 | **No staging fixture procedure.** The smoke test needs a government office with a jurisdiction, a VERIFIED organisation and ACTIVE accounts. None of these can be created through the application (organisation verification has no UI or endpoint, and B1 blocks accounts). | `STAGING_SMOKE_TESTS.md` § Prerequisites. | Engineering | A reviewed, staging-only fixture script that refuses `NODE_ENV=production` and writes only `@samadhaan.test` synthetic records. Not written yet. |

## Preflight checklist

### A. Repository (local, 2026-10-19)

| # | Check | Command | Expected | Status |
| - | --- | --- | --- | --- |
| A1 | Branch and clean tree | `git branch --show-current; git status --porcelain` | `release/staging-candidate`; no output | PASS |
| A2 | Commits on top of `origin/main` | `git log --oneline origin/main..HEAD` | `6e9ceed`, `6397b1a`, `138f1cb` and the preflight-docs commit | PASS (`origin/main` = `4973322`, last fetched; not re-fetched) |
| A3 | No env files, keys, dumps, model binaries or build output committed | `git diff --name-only origin/main..HEAD \| grep -E '(^\|/)\.env($\|\.)\|\.pem$\|\.key$\|\.dump$\|\.joblib\|\.pkl\|\.onnx\|\.pt$\|tsbuildinfo\|/dist/\|\.next/\|/generated/'` | only `.env.example`, `.env.production.example` | PASS |
| A4 | No binary files | `git diff --numstat origin/main..HEAD \| awk '$1=="-"'` | no output | PASS |
| A5 | Secret patterns in added lines (Anthropic, AWS, GitHub, Slack, Google, private keys, JWTs) | `git diff origin/main..HEAD \| grep '^+' \| grep -E 'sk-ant-\|AKIA\|BEGIN .*PRIVATE KEY\|ghp_\|xox[abp]-\|AIza\|eyJhbGciOi'` | no output | PASS. One literal (`zebracrossingsecretphrase`) is a log-leak canary in `test_ml_serving.py`, not a secret. |
| A6 | Env examples hold no secret values | `grep -E '^[A-Z_]*(SECRET\|TOKEN\|PASSWORD\|KEY)=.+' .env.production.example` | no output | PASS (`.env.example` has only the documented local `samadhaan_dev_password` and a placeholder JWT secret) |
| A7 | Lockfile consistent | `npm ci --dry-run` | exit 0 | PASS |
| A8 | Formatting | `npm run format:check`; `cd services/ai && ruff format --check .` | clean | PASS |
| A9 | Lint | `npm run lint --workspace @samadhaan/api`; `… @samadhaan/web`; `ruff check .` | exit 0 | PASS (oxlint: 3 warnings, none blocking) |
| A10 | Types | `npm run typecheck` | exit 0 | PASS |
| A11 | API unit / web / AI tests | `npm test` (api, web); `pytest -q` | 533 / 495 / 234 + 2 skipped | PASS |
| A12 | API e2e | `npm run test:e2e --workspace @samadhaan/api` | 762 passed | PASS (one unexplained flake on 2026-10-19, not reproduced in 4 runs) |
| A13 | Builds | `npm run build` (root) | exit 0 | PASS |
| A14 | Migrations on a clean database | `CHECK_DATABASE_URL=…/samadhaan_migration_check apps/api/scripts/ci/check-migrations.sh` | 22 migrations, idempotent, no drift | PASS (PostgreSQL 17 locally; 16 in CI is NOT RUN) |
| A15 | Dependency audit | `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities | PASS |
| A16 | Secret scan, full history | `gitleaks detect --source . --redact` (CI `security` job) | exit 0 | NOT RUN (no Docker or gitleaks). History includes test fixtures and placeholders that gitleaks may flag; triage any finding instead of suppressing it blindly. |
| A17 | Registration then authenticated use | `POST /auth/register`, then `GET /auth/me` with its cookies | 201, then 200 | **FAIL** (401). Blocker B1. |

### B. Images (static review only)

| # | Check | Command (operator, Docker host) | Expected | Status |
| - | --- | --- | --- | --- |
| B1 | API image builds | `docker build -f infrastructure/docker/api.Dockerfile -t samadhaan/api:$SHA .` | exit 0 | NOT RUN |
| B2 | Migrate image builds | `docker build -f infrastructure/docker/api.Dockerfile --target migrate -t samadhaan/api-migrate:$SHA .` | exit 0 | NOT RUN |
| B3 | Web image builds (per environment) | `docker build -f infrastructure/docker/web.Dockerfile --build-arg API_INTERNAL_URL=http://<api-internal>:4000 -t samadhaan/web:$SHA-staging .` | exit 0 | NOT RUN |
| B4 | AI image builds | `docker build -f infrastructure/docker/ai.Dockerfile -t samadhaan/ai:$SHA services/ai` | exit 0 | NOT RUN |
| B5 | Non-root, no `.env` inside | `docker run --rm --entrypoint sh <image> -c 'id -u; find / -name .env -not -path "/proc/*" 2>/dev/null'` | uid ≠ 0; no files | NOT RUN |
| B6 | Health checks | `docker inspect --format '{{.State.Health.Status}}' <container>` | `healthy` | NOT RUN |
| B7 | Graceful stop | `docker stop -t 30 <container>`; check the logs | exits within 30 s, no errors | NOT RUN |
| B8 | Production compose valid | `docker compose -f docker-compose.prod.yml --env-file .env.production config --quiet` | exit 0 | NOT RUN |

Static review results:
- Every runtime image is non-root (API and web `node`, AI uid 10001), has a
  liveness `HEALTHCHECK`, uses `STOPSIGNAL SIGTERM`, and is multi-stage.
- The migrate target keeps dev dependencies (`prisma` CLI, `dotenv` for
  `prisma.config.ts`); the runtime prunes them. `dotenv` is imported only by
  the seed script, so the runtime doesn't need it.
- `apps/web/public/vendor/maplibre` is gitignored but regenerated by the web
  `prebuild` hook inside the build stage, so `COPY …/public` succeeds.
- Only Caddy publishes ports in `docker-compose.prod.yml`.
- `post-migrate.sh` strips the query string from `DATABASE_URL`, which drops
  `sslmode`. If staging requires TLS verification, set
  `PGSSLMODE=verify-full` (and `PGSSLROOTCERT`) on the migrate job.

### C. Versions

| Component | Local development | CI (`docker-compose.yml`) | Staging | Requirement | Status |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL | 17.11 | 16 (`postgis/postgis:16-3.4`) | DECISION | 16+ | PASS locally; CI NOT RUN |
| PostGIS | 3.6.4 | 3.4 | DECISION | 3.x | PASS locally |
| pgvector | 0.8.6 | `postgresql-16-pgvector`, **unpinned** (PGDG) | DECISION | **≥ 0.8** (`hnsw.iterative_scan` in search and RAG) | Local PASS; CI version NOT RUN. Confirm with `SELECT extversion FROM pg_extension WHERE extname='vector'`. |
| pg_trgm | 1.6 | bundled | DECISION | any | PASS locally |
| Redis | 8.10.1 | 7 (`redis:7-alpine`) | DECISION | ≥ 7.0 | PASS |
| Node.js | 25.1 | 22 | 22 (images) | 22 (`.nvmrc`) | Local differs from CI and images; CI is authoritative |
| Python | 3.14 | 3.12 | 3.12 (image) | 3.11+ | Same as Node |
| `pg_dump`/`pg_restore` | must match the server's major version | — | — | — | Drill finding (`RECOVERY_RUNBOOK.md`) |

Pick **one** PostgreSQL major version for staging and production. Install
the client tools of that version on whatever runs backups.

### D. Staging (all NOT RUN; needs B2–B4 cleared)

| # | Check | How | Expected |
| - | --- | --- | --- |
| D1 | Extensions | `SELECT extname, extversion FROM pg_extension` | postgis, vector ≥ 0.8, pg_trgm |
| D2 | Migrations | migrate job (`api-migrate` image) | exit 0; `prisma migrate status` up to date |
| D3 | Production checks enforced | start the API with `NODE_ENV=production` | boots only with a valid configuration |
| D4 | Health | `curl -fsS https://<staging>/api/v1/health` | 200, database, Redis and AI `ok` |
| D5 | Metrics protected | `curl -s -o /dev/null -w '%{http_code}' https://<staging>/api/v1/metrics` | 401 without the token (or 404 when unset) |
| D6 | HTTPS, HSTS, cookies | `curl -sI https://<staging>/` | HSTS present; auth cookies `Secure; HttpOnly; SameSite=Lax` |
| D7 | No public data ports | port scan of the staging hosts from outside | only 443 (and 80 redirect) |
| D8 | Stuck-resolution query | `psql "$STAGING_DATABASE_URL" -f scripts/ops/find-stuck-resolutions.sql` | `(0 rows)`; if any, recover each through the withdrawal workflow, never SQL |
| D9 | Room-closure scenarios 1–9 | § Room-closure scenarios | as listed |
| D10 | Object storage | upload, download, private access, unauthorised 403/404, missing object 404 with a synthetic file | as stated |
| D11 | AI provider | analysis, embeddings (384 dimensions), a forced timeout, provider unavailable | COMPLETED; DEGRADED handled; latency and cost recorded |
| D12 | Smoke test | `node scripts/smoke/staging-smoke.mjs` | exit 0, all steps PASS |
| D13 | Multi-tab sessions (production build) | open 4+ tabs at once, signed in | all stay signed in; 1 active session |
| D14 | Restore drill at staging size | `RECOVERY_RUNBOOK.md` § Restore into a new database | counts match; API ready; time recorded |
| D15 | Manual accessibility | `STAGING_SMOKE_TESTS.md` § Manual checks | findings recorded; no conformance claim |

## Push and CI (authorised operator only)

The workflow runs on pushes to `main`, on pull requests and on manual
dispatch. Manual dispatch only works once `ci.yml` exists on the default
branch, and it doesn't yet. **Pushing the branch alone triggers nothing.**
Open a pull request.

```bash
git fetch origin
git log --oneline origin/main..release/staging-candidate   # expect only the release commits
git push -u origin release/staging-candidate
gh pr create --base main --head release/staging-candidate \
  --title "Release candidate: Prompts 27–30, room lifecycle, session fix" \
  --body "Staging candidate. See docs/STAGING_PREFLIGHT.md. Do not merge until CI is green and B1 is resolved."
gh pr checks --watch
gh run list --branch release/staging-candidate --limit 5
gh run view <run-id> --log-failed   # on failure
```

Without `gh`, open the pull request in the GitHub web UI; the checks start on
their own. Record the run id and the five job results (`node-quality`,
`ai-service`, `database-and-e2e`, `security`, `docker-images`) in
`LAUNCH_CHECKLIST.md`. Then enable branch protection on `main` requiring all
five.

## Infrastructure decisions (owner)

1. Provider and region, and the monthly budget with a spend alert.
2. PostgreSQL: managed or self-hosted. One major version (16 or 17); must
   offer PostGIS, pgvector ≥ 0.8 and pg_trgm; PITR backups; private network
   only.
3. Redis ≥ 7 with a password or TLS, on a private network.
4. A private S3-compatible bucket, and a key limited to it (Get, Put,
   Delete, Head).
5. A container runtime: a single VM with `docker-compose.prod.yml` and Caddy,
   or a managed container service. The AI service needs 1–2 GB of RAM.
6. Container registry and the image tag scheme (recommended: git SHA, web
   tagged `<sha>-staging`).
7. Secret store, holding the JWT secret, AI token, database, Redis, storage,
   LLM key and metrics token.
8. Staging hostname and TLS; `CORS_ORIGINS`, `PUBLIC_API_URL` and
   `PUBLIC_WEB_URL` follow from it.
9. Anthropic key for staging, with a spending limit.
10. Log and metrics destination, and who receives alerts.
11. B1 (registration) and B4 (fixtures).

## Staging deployment sequence

1. CI green on the pull request (B2). Build and push the images from the CI'd
   commit, tagged with its SHA.
2. Provision per § Infrastructure decisions. Create the extensions; confirm
   D1.
3. Store the secrets; fill the environment from `.env.production.example`.
   Use `NODE_ENV=production`, never `ALLOW_DEV_SEED`, and never run
   `db:seed`.
4. Back up the database, if it holds anything.
5. Run the migrate job once (D2). The Prompt 27 migrations take exclusive
   locks; on an empty database that's instant.
6. Start the AI service; wait for `/health/live`.
7. Start the API; wait for readiness 200 (D3, D4).
8. Start the web app, then the proxy; check D5–D7.
9. Load the staging-only synthetic fixtures (B4).
10. Run D8–D15 in order and record each result in `LAUNCH_CHECKLIST.md`.

Rollback: redeploy the previous image tags. The schema is forward-only, so if
a migration is incompatible, restore the pre-deploy backup.

## Room-closure scenarios

Locally all are covered by `apps/api/test/room-lifecycle.e2e-spec.ts` (and
`allocation.e2e-spec.ts`), passing. In staging, run them through the API or
the UI with synthetic records only.

| # | Scenario | Expected | Local test |
| - | --- | --- | --- |
| 1 | Office tries to close an active room | 409; room stays OPEN; problem IN_PROGRESS | "refuses premature closure while the problem is in progress" |
| 2 | Official withdraws accepted work with a reason ≥ 10 characters | 200; allocation CANCELLED, project CANCELLED, room CLOSED | "ends the work in one step…" |
| 3 | Problem after withdrawal | VERIFIED, `resolvedAt` null, never RESOLVED | same test |
| 4 | Withdrawal while a verification request is PENDING | 409; nothing changes | "waits for a pending verification decision" |
| 5 | Another office, or an organisation member, withdraws | 403/404; still ACCEPTED | "needs a reason, and only the allocating office may do it" |
| 6 | Second or concurrent withdrawal | 409; exactly one audit trail | "is not applied twice on retry", "two simultaneous withdrawals…" |
| 7 | Reallocation after withdrawal | 201, accepted, new OPEN room; the old organisation loses access | "lets the office reallocate…" |
| 8 | Audit and notifications | `ALLOCATION_CANCELLED`, `PROBLEM_STATUS_CHANGED`, `RESOLUTION_PROJECT_STATUS_CHANGED`, `RESOLUTION_ROOM_CLOSED`; organisation and reporter notified | "ends the work…", "tells the organisation and the reporter" |
| 9 | Resolved problem | withdrawal 409; room close 200 | "cannot be withdrawn, and its room closes normally" |

## Declaring STAGING VERIFIED

All of the following, with results recorded:
- B1 fixed with a test, and B4 written.
- CI green on the release commit, all five jobs.
- Images built from that commit and deployed.
- D1–D14 PASS.
- D15 done, with findings recorded.
- The smoke test passes with a real AI key and real S3 storage. AI DEGRADED
  is acceptable only with a documented reason.

Production stays out of scope until a separate production checklist is
signed off.

## Synthetic users in the local development database

The 2026-10-19 multi-tab test and this audit left 11 synthetic accounts in
the **local development** database: `multitab-*@samadhaan.test` (8 ACTIVE)
and 3 `PENDING_VERIFICATION` registrations (`multitab-dev-*`,
`preflight-register-*`). Together they hold 28 sessions, no audit rows and
no problems. Staging and production are unaffected.

There is **no application workflow to remove or deactivate a user**: no
endpoint, no admin UI. They are harmless where they are. Removing them needs
explicit approval and would be a scoped deletion of their sessions and user
rows in the local database only, the same way the e2e suites clean up their
own users. It isn't done.
