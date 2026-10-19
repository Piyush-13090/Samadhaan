# Test Strategy (Prompt 29)

What is tested, at which layer, where it runs, and how to run it. The
ordinary suites are deterministic and need no external services beyond local
PostgreSQL, Redis and the AI service in development mode. They need no API
keys, no model downloads (except the opt-in suite), no email and no
production systems.

## Layers

| Layer | Where | Count (2026-10-19) | Runs in |
| --- | --- | --- | --- |
| API unit | `apps/api/src/**/*.spec.ts` (Vitest) | 518 tests / 43 files | local, CI |
| API integration and e2e | `apps/api/test/*.e2e-spec.ts` (real PostgreSQL + PostGIS + pgvector, Redis, AI service; supertest against the real `AppModule`) | 747 tests / 29 files | local, CI |
| End-to-end workflows | `test/journeys.e2e-spec.ts` (full civic lifecycle through HTTP); `test/ml.e2e-spec.ts` (model lifecycle) | included above | local, CI |
| Security regressions | `test/security.e2e-spec.ts`, `src/common/security/security.spec.ts`, denied-path assertions in every suite, `test/reliability.e2e-spec.ts` | included above | local, CI |
| Database and migrations | `test/database.e2e-spec.ts` (constraints), `test/performance.e2e-spec.ts` (index usage), `scripts/ci/check-migrations.sh` (clean replay, idempotency, drift, extensions and indexes) | — | local, CI |
| Frontend components and interactions | `apps/web/src/**/*.test.tsx` (Vitest + Testing Library, role-based queries) | 487 tests / 46 files | local, CI |
| Frontend accessibility | `apps/web/src/accessibility.test.tsx` (focus, naming, labels, errors, retry, keyboard tabs) | 8 of the above | local, CI |
| AI service | `services/ai/tests` (pytest, fake providers) | 233 passed, 2 skipped (opt-in) | local, CI |
| AI real-model (opt-in) | `SAMADHAAN_RUN_MODEL_TESTS=1 pytest tests/test_embeddings.py tests/test_matching.py` | 47 passed, with the 2 opt-in cases | local, on model or config change |
| Performance smoke | `apps/api/scripts/perf/load-test.mjs` against a `*_perf` database (Prompt 27) | — | dedicated environment only |
| External providers | Anthropic, geocoding, real object storage | not automated | **staging only**, with real keys |

## Workflows covered end to end

`test/journeys.e2e-spec.ts` uses one fixture set. Users, organisations and
memberships are created with Prisma; **every state transition goes through
the HTTP API.** The journey covers:

1. **Citizen.**
   - Upload a valid JPEG; a text file named `.jpg` is rejected.
   - Report a problem with the photo, and see it served.
   - Wait for the real AI analysis to complete.
   - A neighbour supports, follows and comments. The reporter is notified and
     marks the notification read; the neighbour can't touch it.
2. **Government.**
   - The office sees the problem in its queue; another office's official gets
     403/404.
   - The office moves it to UNDER_REVIEW, then VERIFIED.
   - An invalid jump (VERIFIED → RESOLVED) and a citizen status change are
     refused.
3. **Allocation.** The office allocates to an NGO; an unrelated NGO can't
   accept. The NGO accepts: the problem becomes IN_PROGRESS and the room opens.
4. **Organisation.**
   - The NGO posts a room message; outsiders are refused.
   - The project is activated, and a task created and completed.
   - Evidence: a fake photo is refused; a real one is uploaded and submitted.
5. **Resolution.**
   - The NGO requests verification. The NGO and the other office can't
     approve it; the office approves.
   - The problem is RESOLVED, the project COMPLETED and the evidence APPROVED.
   - The reporter's ledger has `PROBLEM_VERIFIED` and exactly one
     `PROBLEM_RESOLVED`. The audit log holds every key action.
6. **Analytics.** Office 200, citizen 403, other office 404.

The other journeys from the prompt are covered by the module suites:
- search and nearby discovery (`search`, `discovery`, `map`);
- impact and analytics (`impact`, `analytics`);
- organisation recommendations and allocation (`organization-matching`,
  `allocation`);
- AI coordination and knowledge retrieval (`coordinator`, `knowledge`);
- the model lifecycle: register, evaluation rules, approval by a second admin,
  activation, rollback, monitoring and audit (`ml`);
- dataset validation and training (`services/ai/tests/test_ml_*.py`).

## Authorisation and state-transition coverage

Every suite asserts both the allowed and the denied path.
- **Authorisation:**
  - cross-user private data (notifications, discovery, impact, community);
  - cross-organisation workspaces;
  - government jurisdiction;
  - ADMIN not inheriting government powers, and not staffing government
    offices (`reliability`);
  - internal notes;
  - restricted RAG documents in search, citations and answers;
  - model administration;
  - suspended users and organisations.
- **State transitions:** invalid jumps, repeated requests and **concurrent**
  requests for government review, allocation accept, decline and cancel,
  tasks and projects, and verification approval (`government`, `allocation`,
  `projects`, `verification`).
- **Concurrency added in Prompt 29** (`reliability`): duplicate verdicts and
  double-submitted reports.
- **Idempotency:** notification dedupe keys, ledger idempotency keys
  (concurrent replay in `impact`), and the sweep lock (unit).

The gaps the audit identified, and their status, are in
`PRODUCTION_READINESS.md`.

## Commands

```bash
npm ci                                            # lockfile-exact install
npm run format:check                              # Prettier, whole repo
npm run lint --workspace @samadhaan/api           # oxlint
npm run lint --workspace @samadhaan/web           # eslint
npm run typecheck                                 # all workspaces
npm run test --workspace @samadhaan/api           # API unit
npm run test --workspace @samadhaan/web           # web
npm run test:e2e                                  # API e2e (needs PostgreSQL, Redis, AI service)
(cd services/ai && .venv/bin/python -m ruff check . && .venv/bin/python -m ruff format --check . && .venv/bin/python -m pytest -q)
CHECK_DATABASE_URL=postgresql://…/samadhaan_migration_check apps/api/scripts/ci/check-migrations.sh
npm run build --workspace @samadhaan/api && npm run build --workspace @samadhaan/web
npm audit --omit=dev --audit-level=high
```

## Rules

- **No disabled assertions and no unexplained skips.** The only skips are the
  two opt-in real-model tests, gated on `SAMADHAAN_RUN_MODEL_TESTS=1`.
- **No timing assertions in unit tests.** Performance is guarded structurally
  (`performance.e2e-spec.ts`: index usage).
- **Isolated fixtures.** Each suite uses a unique per-run prefix and deletes
  what it created; append-only tables are cleaned through the explicit
  maintenance switch.
- **Run e2e against a database nothing else writes to.** The suite shares the
  development database locally. A running development API's background sweeps
  write to the same database and can interfere: on 2026-10-19 one full run
  had 3 intermittent failures (2 tests and 1 file setup). The three suites
  passed alone, and the next full run passed 747/747. CI uses a dedicated
  database.
- **Snapshot tests aren't used as the only check** of behaviour.
