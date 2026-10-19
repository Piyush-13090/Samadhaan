# Launch Checklist (Prompt 30)

**Overall status: NOT READY for a production launch.** The code is ready for a
staging deployment. Every check that can run on a development machine passes.
What remains needs infrastructure, credentials or a person:
- building and running the images;
- the first CI run;
- staging;
- a real bucket and a real AI key;
- a restore drill.

See `KNOWN_LIMITATIONS.md` (B1–B5, B7, B8; B6 is resolved).

## Staging release record (2026-10-19)

Status: **NO-GO for deploying staging** (updated by the preflight audit,
`STAGING_PREFLIGHT.md`). Self-registration is broken (blocker B1 there), and CI
has never run. Nothing has been deployed. The items below are what the
staging pass actually established.

| Item | Result |
| --- | --- |
| Commits | Branch `release/staging-candidate`: `6e9ceed` (Prompts 27–30 and the room-lifecycle fix, 219 files) and `6397b1a` (multi-tab session fix). This record is a separate docs commit. **Not pushed** (no authorisation). |
| Repository review | 219 entries reviewed. No `.env`, keys, datasets, model binaries or build output staged; secret-pattern scan clean; `npm ci --dry-run` exit 0; `npm audit` 0. |
| Docker images | **NOT RUN.** No Docker on the release machine. Build commands: `DEPLOYMENT_GUIDE.md` § Build. |
| GitHub CI | **NOT RUN.** No `gh` CLI and no authorisation to push. |
| Staging infrastructure | **NOT RUN / BLOCKED.** No provider, region or budget has been chosen; nothing provisioned. |
| Migrations | Clean database: 22 migrations, `post-migrate.sql` idempotent, no drift (`check-migrations.sh`, local PostgreSQL 17). Staging: **NOT RUN.** |
| Stuck-resolution query | Development database: 0 rows. Staging: **NOT RUN.** |
| Room-lifecycle scenarios 1–9 | Covered by `room-lifecycle.e2e-spec.ts` (12 tests) and `allocation.e2e-spec.ts`, all passing locally. Staging: **NOT RUN.** |
| Object storage (S3) | **NOT RUN.** No bucket or credentials; still only unit-tested against a fake client. |
| AI provider | **NOT RUN.** `LLM_PROVIDER=development`, no key. |
| Staging smoke | **NOT RUN** (0/26 against staging). Local result from Prompt 30: 26/26 PASS. |
| Multi-tab sessions | **Reproduced and fixed.** Headless Chrome on the development stack: before the fix, 1 tab (development double mount) and 4 simultaneous tabs both ended with 0 active sessions (the user was signed out). After `6397b1a`, 1, 4 and 8 tabs all stay signed in with exactly 1 active session. Replay detection on the server is unchanged. A production-build browser run is still to do in staging. |
| Backup restore | Local drill **PASS** (`RECOVERY_RUNBOOK.md` § Drill record). It found a runbook gap: client tools must match the server's major version. Staging-sized drill **NOT RUN.** |
| Manual accessibility | **NOT RUN.** Needs a person with real devices and screen readers (§ 5). |
| e2e flake (2026-10-19) | 3 tests in `notifications` and `ml` returned unexpected 404s once. Not reproduced in 4 later full runs (762/762), including one under the same concurrent build load. Cause unknown. Locally, e2e shares PostgreSQL and Redis with the running development API and its sweeps; CI uses dedicated services. Owner: QA, watch the first CI runs. |

Legend: ☑ verified, with the evidence named · ☐ pending (who: Infra / Owner /
QA).

## 1. Code quality (verified locally, 2026-10-19)

| ✓ | Check | Command | Result |
| --- | --- | --- | --- |
| ☑ | Lockfile install | `npm ci --dry-run` | exit 0 |
| ☑ | Formatting | `npm run format:check` | clean |
| ☑ | Lint | `oxlint src/ test/` (API), `eslint` (web), `ruff check .` (AI) | exit 0 |
| ☑ | Types | `tsc --noEmit` (API, web) | exit 0 |
| ☑ | API unit | `npm test` (apps/api) | 533 passed |
| ☑ | API integration and e2e | `npm run test:e2e` | 762 passed / 30 files (2026-10-19) |
| ☑ | Web | `npm test` (apps/web) | 495 passed (2026-10-19) |
| ☑ | AI service | `pytest -q` | 234 passed, 2 skipped (opt-in real-model tests; they pass with the flag, Prompt 29) |
| ☑ | Builds | `nest build`, `next build`, and the standalone `next build` | exit 0 |
| ☑ | Migrations on a clean database | `scripts/ci/check-migrations.sh` | 22 migrations; idempotent post-migrate; no drift; extensions, indexes and append-only triggers present |
| ☑ | Dependency audit | `npm audit --omit=dev --audit-level=high`; `pip-audit` (Prompt 29) | 0 / none |
| ☐ | Secret scan (gitleaks) | CI `security` job | **NOT RUN** (no Docker locally) |
| ☐ | Docker images build; non-root; no `.env` inside | CI `docker-images` job | **NOT RUN** (Infra: first push) |
| ☐ | All CI jobs green on GitHub; branch protection | GitHub | **NOT RUN** |

## 2. Production behaviour (verified locally, without containers)

| ✓ | Check | Evidence |
| --- | --- | --- |
| ☑ | Unsafe production configuration refused at startup | `NODE_ENV=production node dist/main.js` with development values: 9 violations listed, exit |
| ☑ | Valid production configuration boots | Same binary with production values: liveness 200; readiness ok (database, Redis, AI); HSTS present |
| ☑ | Metrics endpoint guarded | 401 without the token, 200 with it; route-template labels only |
| ☑ | CSRF on login | Cross-site origin gets 403 |
| ☑ | Web standalone server and `/api` proxy | `/` and `/login` 200; `/api/v1/health/live` 200 through the proxy; CSP present; `lang="en"` |
| ☑ | Full workflow through the public API | Smoke script 26/26 PASS against a production-built API on a synthetic database |
| ☐ | The same, in staging | **NOT RUN** (Infra / QA) |

## 3. Infrastructure (pending, Infra)

- [ ] PostgreSQL 16+ with PostGIS, **pgvector ≥ 0.8** and pg_trgm. Confirm `max_connections`.
- [ ] Non-owner application database role (`PRODUCTION_CONFIGURATION.md`).
- [ ] Redis 7+ with a password or TLS.
- [ ] Private S3-compatible bucket and a key scoped to it. **Run an upload and download in staging.**
- [ ] Secrets in the platform's secret store (JWT, AI token, DB, Redis, storage, LLM key, metrics token).
- [ ] TLS termination, with one proxy hop in front of the API.
- [ ] Log shipping (searchable by request id); metrics scraping; alerts (readiness 503, 5xx rate, `ai_circuit_state=2`, job failures, storage errors).
- [ ] Automated daily backups and point-in-time recovery; one **timed restore drill** at staging size (local drill passed 2026-10-19). Use client tools matching the server's major version.
- [ ] Build images per environment (web: `API_INTERNAL_URL`); run the migrate job; deploy AI, then API, then web.

## 4. Product and owner decisions (pending, Owner)

- [x] Room-closure exit path (B6): cancel-and-reallocate via allocation withdrawal; rooms can't close mid-work.
- [ ] Anthropic key, model choice and a monthly spend alert.
- [ ] Accept, or schedule: no email notifications, no admin UI for organisation verification, in-app notifications only.
- [ ] Authorisation intent questions (`PRODUCTION_READINESS.md`): public office member lists; officials verifying their own reports; MEMBER versus OWNER powers in offices.

## 5. Staging sign-off (pending, QA)

- [ ] `node scripts/smoke/staging-smoke.mjs`: all PASS, or AI DEGRADED only with a documented reason.
- [ ] Manual browser checks (`STAGING_SMOKE_TESTS.md`): mobile, keyboard-only, AI labelling, attachment privacy.
- [ ] Screen-reader spot check of reporting and review.
- [ ] Load smoke on staging hardware (`apps/api/scripts/perf`).

## 6. Launch day

1. Back up.
2. Run the migrate job.
3. Deploy AI, then API, then web.
4. Readiness 200.
5. Run the smoke test against **staging** first, never production.
6. Watch metrics for 1 hour.
7. Rollback plan: `DEPLOYMENT_GUIDE.md` and `RECOVERY_RUNBOOK.md`.
