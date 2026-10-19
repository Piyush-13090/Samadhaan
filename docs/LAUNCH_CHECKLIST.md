# Launch Checklist (Prompt 30)

**Overall status: NOT READY for a production launch.** The code is ready for a
staging deployment. Every check that can run on a development machine passes.
What remains needs infrastructure, credentials or a person:
- building and running the images;
- the first CI run;
- staging;
- a real bucket and a real AI key;
- a restore drill.

See `KNOWN_LIMITATIONS.md` (B1–B5, B7; B6 is resolved).

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
| ☑ | API integration and e2e | `npm run test:e2e` | 749 passed / 29 files |
| ☑ | Web | `npm test` (apps/web) | 488 passed |
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
- [ ] Automated daily backups and point-in-time recovery; one **timed restore drill**.
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
