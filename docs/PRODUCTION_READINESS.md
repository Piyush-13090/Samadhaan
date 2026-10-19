# Production Readiness (Prompt 29, updated in Prompt 30)

> **Prompt 30 update.** Resolved since Prompt 29:
> - object storage (S3-compatible driver);
> - application images and deployment files;
> - metrics endpoint;
> - fixes for the refresh-token race, the login rate limiter failing open, and
>   TRUNCATE on append-only tables;
> - removal of fabricated UI (settings mock, fixture statistics, dead admin
>   links).
>
> What remains is in [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md), and the
> launch status in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md). The text
> below is the Prompt 29 assessment, kept as the record.

An evidence-based assessment of where Samadhaan stands before a production
release: what was audited, what was found and fixed, what has been verified,
and what still blocks production. **Samadhaan is not production-ready yet.**
The blockers are listed below; none is hidden by a green test run.

Verification commands and their results are in
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md). The test layers are in
[TEST_STRATEGY.md](./TEST_STRATEGY.md), and recovery procedures in
[RECOVERY_RUNBOOK.md](./RECOVERY_RUNBOOK.md).

## How the audit was done

Four read-only audits, each required to cite file:line evidence, covered:
- authorisation and tenant isolation;
- state machines, transactions and idempotency;
- uploads and storage;
- AI and external-integration resilience.

Release machinery (CI, Docker and deployment configuration, health checks,
dependencies) was checked directly. Every defect listed as fixed was first
confirmed in the code. Suspicions that weren't confirmed are listed as such.

## Highest-priority findings

| # | Severity | Finding | Status |
| - | --- | --- | --- |
| 1 | **High** (release) | **No CI at all.** The repository had no `.github/`, so nothing enforced lint, types, tests, migrations or builds. | **Fixed:** `.github/workflows/ci.yml` (see below). It hasn't run on GitHub yet; see the checklist. |
| 2 | High | **AI work outlived its caller.** Anthropic SDK timeout 60 s × 3 attempts against API timeouts of 8–120 s: the API gave up while the provider kept running and billing. Up to 9 provider calls per report. | **Fixed:** the API sends `x-deadline-ms`; the AI service bounds each provider call, SDK retries included, by `min(deadline − 1 s, LLM_DEADLINE_SECONDS=55)`. Tested (`test_resilience.py`). |
| 3 | High | **A new Anthropic client per request.** Every LLM route built a fresh `AsyncAnthropic` and connection pool, never closed. | **Fixed:** one cached client per configuration, closed on shutdown. Tested. |
| 4 | Medium | **A failed double-submit deleted a saved report's photos.** The cleanup `catch` also covered post-commit steps; the losing duplicate request (unique `storageKey`) deleted the files of the winner. A post-commit Redis/DB blip also returned 500 for a saved report. | **Fixed:** `discard` never deletes a referenced file; post-commit steps are best-effort and logged. Uncaught unique violations return 409. Regression e2e. |
| 5 | Medium | **A platform ADMIN could staff a government office** (invite or promote members), an indirect route to jurisdiction privileges. | **Fixed:** admins can't manage government-office membership; they still can for other organisations. Regression e2e (allowed and denied). |
| 6 | Medium | **No failure isolation for the AI service.** When it hangs, 7 user-facing paths each held a request for 8–150 s. | **Fixed:** per-endpoint-group circuit breaker in `AiClient` (5 consecutive failures → open 30 s → one trial). Health probes bypass it. Unit-tested. |
| 7 | Medium | **Evidence-verification PDF parsing ran on the event loop** (the same stall fixed for ingestion in Prompt 27). Any non-pypdf exception from a malformed PDF failed the request. | **Fixed:** worker thread under the shared extraction limiter (2); unreadable documents are skipped. Tested. |
| 8 | Medium | **Impact reconciliation could starve and could leave resolution awards partly paid.** Capped awards write no row, so the same oldest problems were re-selected forever; the reporter's award was written first, yet "done" was judged by it. | **Fixed:** a cursor-paged scan that wraps around; the reporter is awarded last, so reconciliation re-runs incomplete sets. |
| 9 | Medium | **Geocoding queue unbounded** (1 rps gate, no maximum wait). | **Fixed:** callers that would wait over 10 s are refused as unavailable without taking a slot. Tested. |
| 10 | Low–Med | **Duplicate verdict lost update.** Confirm and reject wrote unconditionally after a check made outside the transaction; the detector could also overwrite a fresh human verdict. | **Fixed:** conditional updates (first verdict wins → 409), detector writes conditional. Concurrent e2e and unit tests. |
| 11 | Low–Med | **Withdrawn evidence could become AI_REVIEWED** (claim not conditional on status). | **Fixed:** claim conditional on the status read. |
| 12 | Low | **Sweep locks without an owner.** Any instance's `DEL` released the lock, and Redis errors ran the sweep unlocked. | **Fixed:** owner-token lock with compare-and-delete. Idempotent sweeps still run on a Redis error; the coordinator (paid LLM) skips. Unit-tested. |
| 13 | Low | **Allocation accepted by an organisation since rejected or unverified.** | **Fixed:** eligibility re-checked at acceptance. Regression e2e. |
| 14 | Low | **Room images kept EXIF/GPS** (problem and evidence photos were already stripped). | **Fixed:** decoded and re-encoded without metadata. Regression e2e asserts the GPS tag is gone. |
| 15 | Low | **Room list showed rooms to members of suspended organisations**; the public profile counted unpublished drafts. | **Fixed.** Draft count has a regression e2e. |
| 16 | Low | `POST /problems/:id/duplicates/analyze` had no rate limit; Anthropic 429 was reported as a generic error; a misleading "sources are still listed" failure message. | **Fixed** (10 per 10 min; `RATE_LIMITED` → 503; message corrected). |
| 17 | Dependency | 4 high npm advisories (`mysql2`, `deepmerge-ts`) via Prisma 7.10.0. | **Fixed:** Prisma 7.10.1. `npm audit` reports 0 vulnerabilities; `pip-audit` none. |

Things checked and found sound (with evidence in the audit reports):
- Every controller is guarded globally, with `@Public` explicit, and
  sub-resource ids are scoped to their parent.
- Government jurisdiction is enforced server-side, and ADMIN doesn't gain it.
- RAG authorisation is applied in SQL before any passage reaches a prompt.
- Uploads check the actual file content, use server-generated keys, are
  traversal-safe, and return 404 for missing objects.
- Core state transitions are conditional updates in transactions, with
  database backstops: the one-active-allocation index, the one-pending
  verification index, CHECK constraints, and the append-only ledger.
- Liveness and readiness are separate in both services. Readiness is 503 only
  when PostgreSQL is down; Redis and AI make it `degraded`.

## Production blockers

These must be resolved, or explicitly accepted by the owner, before
production. None can be closed by code in this repository alone.

| Blocker | Why it blocks | What's needed |
| --- | --- | --- |
| **No object-storage driver** | `STORAGE_PROVIDER=s3` is refused at boot ("Supported: local"). Local disk means a single API instance with a persistent, backed-up volume. | An S3-compatible driver behind `StorageService`, or an accepted single-host deployment with a backed-up volume. |
| **CI has never run on GitHub** | The workflow was validated by running each step locally (except the Docker-based steps, gitleaks and the GitHub-hosted runner itself). | Push and confirm all four jobs pass; enable branch protection requiring them. |
| **No application container images or deployment manifests** | Only PostgreSQL and Redis are containerised. Graceful shutdown, resource limits and health probes aren't wired to any orchestrator. | Prompt 30 (deployment). |
| **No metrics or alerting backend** | Request latency is logged (`responseTime`), health is probeable, and model inference has its own monitoring table. But nothing aggregates error rates, job failures, circuit-breaker openings or AI fallback rates, or alerts on them. | A log/metrics pipeline and alert rules (see Observability). |
| **No email delivery** | `SMTP_URL` exists in configuration, but no transport is implemented; notifications are in-app only. | Accept in-app only, or implement a mail transport. |
| **Backups never exercised** | The procedure is written (`RECOVERY_RUNBOOK.md`) but no backup has been restored on production-like infrastructure. | Run and time a restore drill in staging. |
| ~~Room-closure dead end~~ | **Resolved.** Rooms close only once the work is over. The office withdraws accepted work (cancel-and-reallocate), which returns the problem to VERIFIED and recovers existing stuck problems. | Run `scripts/ops/find-stuck-resolutions.sql` in each environment after deploying. |
| **Real-provider behaviour unverified** | Tests use the development LLM provider and fake providers; the Anthropic path is tested against a fake client only. | A staging run with a real key: latency, cost, 429 behaviour. |

## Remaining risks and accepted limitations

- **Event bus is in-memory and at-most-once.** A crash between commit and
  delivery loses notifications. Ledger awards are recovered by reconciliation;
  notifications aren't.
- **Python dependencies are not locked** (`requirements.txt` uses ranges), so
  CI and production may resolve different versions. A lock (pip-tools/uv) is
  recommended.
- **No global cap on concurrent LLM work.** Per-user rate limits and the new
  circuit breaker bound it, but a burst of reports runs analyses
  concurrently. A bounded queue for analysis and duplicate jobs is
  recommended.
- **Rate limiting fails open when Redis is down**, which is a documented
  choice. The cost exposure is then bounded only by the circuit breaker and
  provider limits.
- **Unsent room attachments and draft evidence files are never swept**
  (storage growth, bounded by per-user rate limits).
- **Admin point adjustments are not idempotent:** a retried request applies
  twice.
- **The AI service's 64 MB body limit checks `Content-Length` only**
  (internal service, behind the token).
- **Problem-analysis prompt has no `PROMPT_VERSION`** (the other six do).
- **pg deprecation:** overlapping queries on one transaction client log a pg 9
  removal warning. That must be fixed before upgrading pg.
- **Unverified authz items** (product intent needed): government-office
  member lists are public; an official may verify a report they filed;
  office MEMBERs have the same powers as OWNERs; overlapping offices can
  override each other's priority.
- **Model registry:** a concurrent re-evaluation can replace metrics between
  an approver's review and approval (low).

## Observability (verified state)

| Signal | Where | Gap |
| --- | --- | --- |
| Request ids | `x-request-id`, propagated web → API → AI; bound to every log line | — |
| Structured logs | pino (API), structlog (AI). Secrets, cookies and passwords redacted. URLs logged without query strings (Prompt 27). | — |
| Sanitised errors | Opaque 500 bodies; AI provider text never shown to users | — |
| API latency and errors | `responseTime` and status per request in logs | No aggregation |
| PostgreSQL / Redis / AI connectivity | `GET /api/v1/health` (readiness) and `/health/live` | — |
| Background jobs | Log lines per sweep | No success/failure counters |
| AI latency, failures, fallbacks | `processingMs` and status on stored analyses; circuit transitions logged | No aggregation |
| Model inference | `model_inferences` and the monitoring report (Prompt 28) | — |
| Security events | `audit_logs`; rate-limit and CSRF refusals logged | No alerting |
