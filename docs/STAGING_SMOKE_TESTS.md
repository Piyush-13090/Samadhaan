# Staging Smoke Tests (Prompt 30)

`scripts/smoke/staging-smoke.mjs` walks the essential workflow through the
public API with synthetic records. **Staging status: NOT RUN.** No staging
environment or credentials were available. The script itself was run against
a local, production-built API on a dedicated synthetic database
(`samadhaan_perf`) and passed all 26 checks across the 20 steps below
(2026-10-19). It passed 26/26 again later that day using accounts created by
the fixture script below, on a throwaway database marked as staging. Those
runs show the script and the fixtures work; they aren't staging verification.

## Prerequisites (staging)

Never use production accounts or real people's details. The accounts and
organisations below come from the staging fixture script. Organisation
verification and office setup have no application workflow, so the script
creates them, on a positively identified staging database only.

### Creating the test accounts (`staging-fixtures`)

`apps/api/src/database/staging-fixtures.ts`, built to
`dist/database/staging-fixtures.js`. It's included in the API and
`api-migrate` images.

**It creates:**
- `staging-smoke-citizen@samadhaan.test` (CITIZEN);
- `staging-smoke-official@samadhaan.test`, OWNER of the office
  `staging-smoke-office` (jurisdiction: city `SmokeTestCity`);
- `staging-smoke-other-official@samadhaan.test`, OWNER of
  `staging-smoke-other-office` (city `SmokeTestOtherCity`), for the isolation
  check;
- `staging-smoke-ngo-owner@samadhaan.test`, OWNER of the VERIFIED NGO
  `staging-smoke-ngo`.

The fictional cities keep the smoke offices' queues to smoke reports, and
keep smoke reports out of every other office.

**Safety guards.** Any failure refuses the run with exit code 2, before
anything is written:
1. `SAMADHAAN_DEPLOY_ENV` must be exactly `staging`. NODE_ENV isn't used,
   since staging runs `NODE_ENV=production`.
2. It connects only to `STAGING_DATABASE_URL`, never `DATABASE_URL`.
3. `--confirm-database=<name>` must equal the connected `current_database()`.
4. The database must carry the comment
   `samadhaan:environment=staging`. Its owner sets this once, on the
   staging database only:
   `COMMENT ON DATABASE <staging database> IS 'samadhaan:environment=staging';`
5. A name or comment containing "prod" is refused.
6. It touches only rows it owns: `staging-smoke-*@samadhaan.test` emails
   with the `[staging smoke]` name prefix, and `staging-smoke-*` slugs with
   the fixture description. If a reserved email or slug is held by anything
   else, it refuses, so no real organisation is ever verified.
7. It never deletes or truncates.

**Credentials.** Passwords are random. They are written only to
`--credentials-out`: an absolute path outside any Git working tree, created
with mode 0600. They are never printed; the output lists only emails and
slugs. Move the file's values into the staging secret store, then delete the
file. Re-running needs the same file, because it verifies the stored
passwords against the database. Without the file, pass
`--rotate-passwords`, which issues new passwords and revokes the fixtures'
sessions.

```bash
# From apps/api on a host that can reach the staging database privately,
# or: docker run --rm -e … samadhaan/api-migrate:<sha> node dist/database/staging-fixtures.js …
SAMADHAAN_DEPLOY_ENV=staging STAGING_DATABASE_URL='postgresql://…/<staging db>' \
  node dist/database/staging-fixtures.js \
    --confirm-database=<staging db> --credentials-out=/secure/path/staging-smoke.env
```

The output file holds every `SMOKE_*` variable below except
`SMOKE_WEB_URL`. Its values contain no spaces, so it works with both
`source` and `docker --env-file`.

**Clean-up (no deletes):**
```bash
SAMADHAAN_DEPLOY_ENV=staging STAGING_DATABASE_URL=… \
  node dist/database/staging-fixtures.js --confirm-database=<staging db> --retire
```
This suspends the fixture accounts, revokes their sessions and deactivates
the fixture organisations. Re-running without `--retire` restores them.
Smoke reports stay, titled `[SMOKE TEST …]`.

**Verified locally (2026-10-19):**
- Refusals, each exiting 2 with nothing written: no environment, deploy env
  `production`, only `DATABASE_URL` set, the unmarked development database,
  a confirmation mismatch, a credentials path inside the repository, a
  relative credentials path, and reserved email/slug held by a non-fixture
  record (that record was left untouched).
- On a throwaway database marked as staging: creation; an idempotent re-run
  (same rows, same hashes); a refusal without the credentials file; rotation;
  retire (all rows kept); and the smoke test at 26/26 with no password in
  any output.
- Staging: **NOT RUN.**

Step 4 signs in with the fixture citizen. Self-registration has its own
regression suite (`apps/api/test/registration.e2e-spec.ts`).

| Variable | What |
| --- | --- |
| `SMOKE_WEB_URL` | Staging web origin, e.g. `https://staging.example.org` |
| `SMOKE_CITIZEN_EMAIL` / `_PASSWORD` | A synthetic citizen account |
| `SMOKE_OFFICIAL_EMAIL` / `_PASSWORD`, `SMOKE_OFFICE_SLUG` | An official of a staging government office |
| `SMOKE_LATITUDE` / `SMOKE_LONGITUDE` / `SMOKE_CITY` | A point inside that office's jurisdiction |
| `SMOKE_ORG_EMAIL` / `_PASSWORD`, `SMOKE_ORG_SLUG`, `SMOKE_ORG_ID` | Owner of a VERIFIED staging organisation |
| `SMOKE_OTHER_OFFICIAL_*` (optional) | An official of a different office, for the isolation check |
| `SMOKE_AI_WAIT_SECONDS` (optional) | Default 90 |

Run:

```bash
node scripts/smoke/staging-smoke.mjs
```

The exit code is 1 if any step fails. The script refuses URLs that look like
production unless `SMOKE_I_KNOW_THIS_IS_STAGING=1` is set. Each run creates
one resolved report titled `[SMOKE TEST <timestamp>]`; archive these
periodically.

## Steps

| # | Step | Pass condition | Local run (perf DB) | Staging |
| - | --- | --- | --- | --- |
| 1 | Web app loads | `/` is 200 HTML | PASS | NOT RUN |
| 2 | API liveness | `/api/v1/health/live` is 200 | PASS | NOT RUN |
| 3 | API readiness | 200; database, Redis and AI listed (DEGRADED if AI is down) | PASS (all ok) | NOT RUN |
| 4 | Citizen login, then an authenticated request | 200 / `/auth/me` 200 | PASS | NOT RUN |
| 5 | Disguised file refused | 4xx | PASS (400) | NOT RUN |
| 6 | Image upload (configured storage) | 201 | PASS (local storage) | NOT RUN (S3 not exercised anywhere yet) |
| 7 | Report submitted and readable, photo served | 201, 200, 200 | PASS | NOT RUN |
| 8 | AI analysis | COMPLETED, or DEGRADED with the report still usable | PASS (development provider) | NOT RUN |
| 9 | Similar-problem retrieval | 200 | PASS | NOT RUN |
| 10 | Citizen can't act as government | 403 | PASS | NOT RUN |
| 11 | Another office can't read the report | 403/404 | PASS (404) | NOT RUN |
| 12 | Government review and verification | 200/200 | PASS | NOT RUN |
| 13 | Allocation created and accepted; room opened | 201, 200 + roomId | PASS | NOT RUN |
| 14 | Room message; citizen can't read the room | 201; 403/404 | PASS | NOT RUN |
| 15 | Project activated; task TODO → IN_PROGRESS → COMPLETED | 200/201/200/200 | PASS | NOT RUN |
| 16 | Evidence created, file uploaded, submitted | 201/201/200 | PASS | NOT RUN |
| 17 | Verification requested; official approves; problem RESOLVED | 200/200/RESOLVED | PASS | NOT RUN |
| 18 | Notifications | 200/200 | PASS | NOT RUN |
| 19 | Analytics: official 200, citizen 403 | — | PASS | NOT RUN |
| 20 | Logout revokes the session | 204, then `/auth/me` 401 | PASS | NOT RUN |

## Manual checks (staging)

These need a person; none has been done.

- [ ] Browser: sign in, report with a phone-sized viewport, map picker, view report. Repeat keyboard-only.
- [ ] The real AI provider produced a sensible analysis (category, severity, summary labelled as AI).
- [ ] An uploaded photo is visible to the public on the report page, and a resolution-room attachment isn't publicly reachable.
- [ ] Health and metrics appear in the monitoring system; an alert fires when the AI service is stopped.
