# Known Limitations (Prompt 30)

What Samadhaan doesn't do, or hasn't proven, at the end of the 30-prompt
roadmap. Each entry is marked as a **launch blocker** (resolve before
production), a **risk** (accepted with mitigation), or a **gap** (a missing
capability, documented honestly).

## Launch blockers

| # | Limitation | Evidence | To close |
| - | --- | --- | --- |
| B1 | **Nothing has been deployed or run in staging.** The staging smoke test is NOT RUN. | `STAGING_SMOKE_TESTS.md` | Provision staging, run the script and the manual checks |
| B2 | **Container images haven't been built or run** (Docker isn't installed on the development machine). | `DEPLOYMENT_GUIDE.md` | Green `docker-images` CI job; boot the production compose stack |
| B3 | **CI has never run on GitHub.** The workflow was validated by running its steps locally. | `RELEASE_CHECKLIST.md` | Push; all five jobs green; branch protection |
| B4 | **S3 storage is untested against a real bucket**: unit-tested against a fake client only. | `s3-storage.service.spec.ts` | Staging upload and download with the real provider |
| B5 | **Backups never restored on production-like infrastructure.** A local drill passed on 2026-10-19. | `RECOVERY_RUNBOOK.md` § Drill record | Timed restore drill in staging, at real data size |
| ~~B6~~ | **Resolved (post-Prompt 30).** Room-closure dead end. A room can no longer close while its work is active. The office withdraws accepted work instead, which returns the problem to VERIFIED for reallocation and also recovers problems already stuck. | `ALLOCATION.md` §9a; `test/room-lifecycle.e2e-spec.ts`; `scripts/ops/find-stuck-resolutions.sql` | Run the detection query in each environment after deploying (0 rows in development) |
| B7 | **Real AI provider behaviour unverified**: latency, cost, 429 handling with a real key. | Tests use fakes and the development provider | Staging run with a key and a budget alert |

## Risks (accepted, mitigated)

- **Intermittent e2e 404s (seen once, 2026-10-19).** Three tests in
  `notifications.e2e` and `ml.e2e` failed once with unexpected 404s, then
  passed in 4 full runs. Cause unknown. Locally the suite shares its database
  and Redis with the running development API; CI doesn't. Watch the first CI
  runs (owner: QA).
- **Session refresh in browsers without Web Locks** (very old browsers) is
  still unserialised. Tabs refreshing at the same moment there can trigger
  replay detection and sign the user out. Every current major browser
  supports Web Locks.

- **In-memory event bus (at-most-once).** A crash between commit and delivery
  loses notifications. Ledger awards are reconciled; notifications aren't.
- **Real-time revocation lag.** A user removed from a resolution room keeps
  receiving its live events for up to 60 s. The stream limit (5 per user) is
  per instance.
- **User-level rate limits fail open when Redis is down.** Search, AI-backed
  and similar routes do. Login, registration and refresh fall back to
  per-process limits. The circuit breaker and provider quotas bound the cost.
- **No global cap on concurrent LLM work** beyond per-user limits and the
  breaker.
- **Python dependencies aren't locked** (version ranges in
  `requirements.txt`); images may resolve newer versions over time.
- **Unsent resolution attachments and draft evidence files** are never swept.
- **Admin point adjustments** aren't idempotent on retry.
- **CSP allows `'unsafe-inline'` scripts.** Next.js inline bootstrap needs it
  without nonces.
- **The analysis prompt has no `PROMPT_VERSION`** (the other prompts do).
- **pg deprecation warning:** overlapping queries on one transaction client
  must be fixed before upgrading to pg 9.

## Gaps (not implemented)

- **Email delivery** (`SMTP_URL` is reserved; notifications are in-app only).
- **Admin user and organisation management UI.** The admin dashboard is a
  placeholder, and organisation verification is a database operation. The
  dead navigation links were removed in Prompt 30.
- **Account settings page.** It was a mock and now redirects to the profile
  page, which persists changes. Notification preferences don't exist.
- **Public platform statistics.** The landing page shows none. Fixture
  numbers were removed in Prompt 30.
- **Image embeddings / visual duplicate detection.**
- **No trained ML model in production**: no human-reviewed labels exist yet
  (`ML_CAPABILITY_INVENTORY.md`).
- **Multilingual (Hindi, Marathi) text** isn't specifically supported by the
  embedding model.

## Accessibility (WCAG 2.2 AA): not claimed

**Done:**
- automated regression tests for the shared primitives (dialogs, drawers,
  forms, errors, tabs, toasts);
- a code audit, fixing:
  - colour contrast of muted text, the AI badge and form-control borders,
    computed to AA;
  - announcements (toasts get persistent live regions, and errors persist);
  - reduced motion on the map;
  - the focus token.

**Not done:**
- a screen-reader pass on real devices;
- zoom to 400% and text-spacing checks;
- full keyboard walkthroughs of every flow;
- a manual check of mobile touch targets.

**Remaining known items:**
- role changes and the priority-override removal apply without confirmation;
- smooth scrolling ignores reduced motion in three places;
- a few full-page states lack an `h1`;
- small touch targets in the search clear button;
- no map legend on phones.

## Security

The Prompt 26, 29 and 30 audits found no open critical or high issue. The
Prompt 30 fixes were:
- refresh-token race;
- login rate limiter failing open;
- TRUNCATE on append-only tables;
- query strings in error logs;
- production checks for Redis, storage and AI log level.

Production must also use a non-owner database role (see
`PRODUCTION_CONFIGURATION.md`). No external penetration test has been done.
