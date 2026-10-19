# Release Checklist (Prompt 29)

Tick an item only when its evidence exists. "Local" means it was run on a
developer machine (macOS, PostgreSQL 16 client / 17 server via Homebrew,
Redis 8, Node 22, Python 3.14). "CI" means the GitHub Actions workflow, which
**has not run yet**: it was added in this prompt and nothing has been pushed.

## A. Quality gates (evidence: 2026-10-19, local)

| ✓ | Item | Command | Result |
| --- | --- | --- | --- |
| ☑ | Lockfile integrity | `npm ci --dry-run` | exit 0 |
| ☑ | Formatting | `npm run format:check` | "All matched files use Prettier code style!" (43 source files reformatted to the repo's config in this prompt, layout only; vendored map bundles excluded via `.prettierignore`) |
| ☑ | API lint | `npx oxlint src/ test/` (apps/api) | exit 0 |
| ☑ | Web lint | `npm run lint` (apps/web) | exit 0 |
| ☑ | Typecheck | `tsc --noEmit` (API, web) | exit 0 |
| ☑ | API unit | `npm test` (apps/api) | 518 passed / 43 files |
| ☑ | API e2e | `npm run test:e2e` | **2nd run 747 passed / 29 files.** The 1st run had 3 intermittent failures (see TEST_STRATEGY.md: shared development database); those suites passed alone. |
| ☑ | Web tests | `npm test` (apps/web) | 487 passed / 46 files |
| ☑ | AI lint and format | `ruff check .`, `ruff format --check .` | passed; 117 files formatted |
| ☑ | AI tests | `pytest -q` | 233 passed, 2 skipped (opt-in) |
| ☑ | AI real-model tests | `SAMADHAAN_RUN_MODEL_TESTS=1 pytest tests/test_embeddings.py tests/test_matching.py` | 47 passed |
| ☑ | Builds | `npm run build` (API, web) | exit 0 |
| ☑ | Migrations: clean replay, idempotent post-migrate, drift, indexes | `scripts/ci/check-migrations.sh` | "migration check passed (21 migrations)". The drift detector was proven to catch a stray column. |
| ☑ | Dev database at head | `npx prisma migrate status` | "Database schema is up to date!" |
| ☑ | Dependency audit (npm) | `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities (after Prisma 7.10.1) |
| ☑ | Dependency audit (Python) | `pip-audit -r services/ai/requirements.txt` (throwaway venv) | No known vulnerabilities |
| ☐ | Secret scan | gitleaks (CI job) | **Not run locally:** Docker isn't installed on the development machine. |
| ☐ | Python type check | — | Not configured in the repository (no mypy or pyright). |

## B. CI (to complete on first push)

| ✓ | Item | Evidence needed |
| --- | --- | --- |
| ☐ | `node-quality` green | GitHub Actions run URL |
| ☐ | `ai-service` green | run URL |
| ☐ | `database-and-e2e` green. This is the first time the documented `docker compose` PostgreSQL image (PostGIS 3.4 + pgvector) is exercised from a clean checkout. | run URL |
| ☐ | `security` green (npm audit, pip-audit, gitleaks) | run URL. Gitleaks may need allow-list entries for test fixtures. |
| ☐ | Branch protection requires all four jobs | repository settings |
| ☑ | Workflow needs no secrets (fork PRs run it) | `ci.yml`: generated JWT secret, throwaway CI database password |
| ☑ | Workflow YAML parses | `yaml.safe_load`: jobs node-quality, ai-service, database-and-e2e, security |

## C. Staging (before production)

| ✓ | Item |
| --- | --- |
| ☐ | Production configuration passes `productionIssues()` (secure cookies, real secrets, AI token, CORS without `*`, `ALLOW_DEV_SEED` off) |
| ☐ | Storage decision made: S3-compatible driver, or an accepted single host with a backed-up volume (`PRODUCTION_READINESS.md` blocker) |
| ☐ | Real Anthropic key: one analysis, one knowledge answer and one verification succeed; a forced 429 maps to `RATE_LIMITED`; deadlines hold |
| ☐ | Backup taken, restored into a new database, `migrate status` clean, application healthy (`RECOVERY_RUNBOOK.md`); time recorded |
| ☐ | `prisma migrate deploy` run against a copy of production data; lock durations of the Prompt 27 table rewrites measured |
| ☐ | Load smoke (`scripts/perf/load-test.mjs`) on staging hardware against a `*_perf` copy |
| ☐ | Logs shipped and searchable by request id; alerts on readiness 503, error rate, and circuit opens |
| ☑ | Room-closure exit path implemented (allocation withdrawal; `ALLOCATION.md` §9a) |
| ☐ | Manual accessibility pass on report, review, allocation and verification flows (keyboard only and screen reader). Automated tests cover the shared primitives only. |

## D. Release day

1. Back up the database and storage.
2. `prisma migrate deploy`, then `post-migrate.sql`.
3. Deploy the AI service, then the API, then the web app. The AI service is
   backward-compatible with the old API, and the API tolerates the AI service
   being briefly unavailable.
4. Check readiness: `GET /api/v1/health` is 200 with `database: ok`.
5. Watch for: 5xx rate, `AI service circuit` log lines, analysis FAILED rate.
6. **Rollback:** redeploy the previous application version. The database is
   forward-only, so a migration that can't coexist with the previous version
   needs the pre-deploy backup (`RECOVERY_RUNBOOK.md`).
