# Staging Smoke Tests (Prompt 30)

`scripts/smoke/staging-smoke.mjs` walks the essential workflow through the
public API with synthetic records. **Staging status: NOT RUN.** No staging
environment or credentials were available. The script itself was run against
a local, production-built API on a dedicated synthetic database
(`samadhaan_perf`) and passed 26 of 26 steps (2026-10-19). That run shows the
script works; it isn't staging verification.

## Prerequisites (staging)

Create these once in staging. Never use production accounts or real people's
details.

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
