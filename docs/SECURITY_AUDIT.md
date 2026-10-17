# Security audit

Prompt 26 audit of Prompts 1–25. Threat model:
[`THREAT_MODEL.md`](./THREAT_MODEL.md). Guidelines:
[`SECURITY_GUIDELINES.md`](./SECURITY_GUIDELINES.md). Incidents:
[`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md).

## Method

- **Scope.** Five passes covered the API (about 190 routes), the web app, the
  AI service and the configuration:
  - authentication and sessions;
  - authorisation, IDOR, tenant isolation and jurisdiction;
  - uploads and storage;
  - SSRF, the AI service, prompt injection and secrets;
  - realtime (SSE), XSS, errors and logging, notifications and jobs.
- **Tooling.** Dependencies were checked with `npm audit` and `pip-audit`.
- **Evidence standard.** A finding is listed only if it was confirmed in code
  or by a test. One reported issue was **refuted** and is not counted: a
  claim that multipart uploads had no size limit. Each module registers
  `MulterModule` with limits.
- **Severity** follows the policy in
  [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md#severity-policy).
- **Verification** names the regression test, where one exists:
  - `security.e2e` = `apps/api/test/security.e2e-spec.ts`
  - `security.spec` = `apps/api/src/common/security/security.spec.ts`
  - `hardening` = `services/ai/tests/test_hardening.py`
  - `web security` = `apps/web/src/security.test.tsx`

## Baseline

| | Critical | High | Medium | Low | Informational |
| --- | --- | --- | --- | --- | --- |
| **Before** | 0 | 2 | 9 | 22 | 10 |
| **After** | 0 | 0 | 1 | 3 | 10 |

**No critical findings were identified during this audit.**

**What remains open:**

- **One medium (M-8)** needs an owner action: removing already-committed test
  uploads from git.
- **Three lows and the informational items** are accepted risks, explained
  below.

---

## High

### H-1 — AI service accepted unauthenticated calls

- **Component:** `services/ai/app/core/security.py`, `core/config.py`;
  `apps/api/src/config/env.schema.ts`.
- **Risk:** `require_internal_token` returned early whenever no token was
  configured, in every environment, and the API treated `AI_SERVICE_TOKEN`
  as optional in production. Anyone who could reach the AI port could:
  - bypass NestJS authorisation and rate limits;
  - spend paid model credit;
  - probe the prompts.
- **Fix:**
  - The AI service refuses to start in production without a token of 32 or
    more characters, refuses requests if one is somehow missing, and
    compares tokens in constant time (`hmac.compare_digest`).
  - The API refuses to start in production without `AI_SERVICE_TOKEN`.
- **Verification:** `hardening` (`TestProductionSettings`,
  `TestServiceAuthentication`) and `security.spec` (production
  configuration).

### H-2 — Dependencies with critical and high advisories

- **Component:** lockfile.
- **Risk:** `npm audit` reported 4 critical and 14 high advisories,
  including:
  - Next.js 16.3.5 (RCE in `next/og`; draft-mode cache leak);
  - `proxy-addr` (IP spoofing);
  - `multer` (DoS);
  - `sharp`'s bundled librsvg;
  - `shell-quote` (dev tooling).
- **Fix:**
  - Next.js and `eslint-config-next` moved to 16.4.0, the same major.
  - `npm audit fix` applied every non-breaking fix.
  - The result is **0 critical**. The 9 remaining highs are in build and CLI
    tooling (accepted risk I-8).
  - `pip-audit` reports no known vulnerabilities, and the `pypdf` floor was
    raised to 6.0.
- **Verification:** `npm audit`, `pip-audit`, and the full test suites.

## Medium

| ID | Finding | Component | Fix | Verification |
| --- | --- | --- | --- | --- |
| M-1 | Public problem photos kept EXIF/GPS, device data and appended bytes (polyglots) | `problems.service.ts` `uploadImage` | Re-encode with sharp (`rotate()`; no metadata written) before storing | `security.e2e` "strips EXIF and GPS…" |
| M-2 | A reporter could force their own problem to `DUPLICATE` from any status. This took verified, allocated, in-progress or rejected reports out of the government workflow, and could earn points | `duplicate-detection.service.ts` `confirm()` | Only from SUBMITTED/UNDER_REVIEW, with a conditional update (409 otherwise) | `security.e2e` "does not let a reporter…" |
| M-3 | Prompt injection: the problem-analysis and project-coordinator prompts interpolated citizen and member text without delimiters or neutralisation, and with no "data, not instructions" rule | `services/ai/app/prompts/problem_analysis.py`, `project_coordinator.py` | `<report>` and `<project_context>` / `<note>` blocks; every free-text field neutralised; newlines folded so section headers cannot be forged; `<<…>>` escaped; explicit untrusted-data rules; prompt versions bumped | `hardening` `TestPromptInjection` |
| M-4 | No security headers on the API or web app; `X-Powered-By` exposed | `bootstrap.ts`, `next.config.ts` | API: nosniff, `DENY`, CSP `default-src 'none'`, referrer, COOP/CORP, permissions, `no-store`, and HSTS in production. Web: a compatible CSP (`frame-ancestors 'none'`, `object-src 'none'`), `DENY`, nosniff, referrer, permissions, and HSTS in production. Both drop `X-Powered-By` | `security.e2e` headers; `web security` |
| M-5 | CSRF defence relied only on `SameSite=Lax`. The browser calls the API cross-origin but same-site, so a sibling origin could send state-changing requests | `bootstrap.ts` | `csrfOriginCheck`: unsafe methods must come from an allowed `Origin`/`Referer`; `Sec-Fetch-Site: cross-site` and `Origin: null` are refused; non-browser clients (no Origin) still work | `security.spec`; `security.e2e` CSRF |
| M-6 | Production configuration was not enforced: cookies could be non-Secure, the AI token was optional, the `.env.example` JWT placeholder passed validation, and CORS origins were unchecked | `env.schema.ts` | `productionIssues()` refuses to boot with any of these | `security.spec` production configuration |
| M-7 | Uploads that were never attached were never deleted: disk exhaustion (about 800 MB per hour per account), and they stayed publicly fetchable | `pending-upload.service.ts` | Uploads are indexed in a Redis sorted set; a bounded, idempotent sweep deletes unattached files after the claim window. It checks `problem_images` first | Code review; full suites |
| M-8 | User uploads were not git-ignored; five test uploads are tracked | `.gitignore` | Added `.storage/`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`. **Owner action:** run `git rm -r --cached apps/api/.storage` and commit | `git check-ignore` |
| M-9 | The development docker-compose published Postgres and Redis on all interfaces; Redis had no password | `docker-compose.yml` | Bound to `127.0.0.1`; Redis takes an optional `REDIS_PASSWORD` (required in production) | YAML parse (Docker unavailable in the audit environment) |

## Low

| ID | Finding | Fix | Verification |
| --- | --- | --- | --- |
| L-1 | Suspension and role changes took effect only at access-token expiry, because they were read from JWT claims | The session lookup now reads the user's current status, role and deletion; same indexed query | `security.e2e` suspension and role |
| L-2 | The login and registration limits keyed on IP + email only, allowing password spraying across many emails | IP-wide ceiling (`ipMax`: login 50/5 min, register 20/h) | `security.e2e` "limits sign-in attempts…" |
| L-3 | Open SSE streams survived sign-out, sign-out-everywhere and suspension for up to 15 minutes | The 60-second re-check also verifies the session | Code review |
| L-4 | No cap on concurrent SSE streams per user | At most 5 per user per instance (429) | Code review |
| L-5 | `x-request-id` was trusted unchecked (log forging), and log ids differed from response ids | `resolveRequestId`: plain ≤64 characters, else a UUID; decided once | `security.spec`; `security.e2e` |
| L-6 | The AI service's error text was stored and shown to users | Fixed messages by error code; upstream text logged only | `ai.service.spec` |
| L-7 | The verification startup reset re-queued reviews another instance was running | Only reviews untouched for 10 minutes or more | Code review |
| L-8 | The knowledge-ingestion claim was not exclusive, and automatic retries were unbounded | A 15-minute lease; startup retries capped at 5 | Code review; knowledge e2e |
| L-9 | A knowledge uploader kept edit/delete rights after leaving the office or organisation | Rights follow current membership, by visibility | `security.e2e` "removes knowledge editing rights…" |
| L-10 | A platform administrator could invite themselves into any organisation | Self-invitation refused | `security.e2e` |
| L-11 | No separation of duties: an official who was also a member of the assigned organisation could allocate to it and approve its work | Both actions refused for such members | `security.e2e` "separates duties…" |
| L-12 | The public media route used a case-sensitive deny-list of private prefixes | Exact allowlist for problem-photo keys | `security.e2e` media |
| L-13 | File-name sanitising was inconsistent: bidi overrides passed, and multer's Latin-1 decoding mangled UTF-8 names | One `cleanFileName` everywhere: strips `\p{Cc}\p{Cf}`, repairs Latin-1 | `security.spec`; `security.e2e` |
| L-14 | The public `/health` returned raw database and Redis error text | Generic messages; detail logged | Code review |
| L-15 | AI service hygiene: non-constant-time token compare, credentialed wildcard-capable CORS, the 422 handler echoing input values, no body limit, forged request ids | All fixed (§H-1, plus a 64 MB limit, location-and-type-only 422 bodies, explicit CORS) | `hardening` `TestErrorHygiene` |
| L-16 | The admin impact adjustment wrote the ledger before the audit entry | The audit entry is written first | Code review |
| L-17 | Manual AI re-analysis (paid) had no rate limit | 10 per hour per user | Code review |
| L-18 | Outbound calls followed redirects, which could carry `x-internal-token` or the geocoder key elsewhere | `redirect: 'error'` | Code review |
| L-19 | Oversized or malformed bodies returned 500 | Mapped to 413/400 | `security.e2e` "bounds and validates…" |
| L-20 | Photos of deleted or draft problems stay fetchable by their (random, 128-bit) key, with a one-year immutable cache | **Accepted** (see below) | — |
| L-21 | Evidence uploads buffer up to 50 MB in memory before type-specific limits apply | **Accepted** (see below) | — |
| L-22 | The development seed uses a fixed password | **Accepted.** It is refused in production (`ALLOW_DEV_SEED` and `NODE_ENV`) | — |

## Informational (recorded, accepted or partially addressed)

- **I-1.** Rate limiting fails open when Redis is unavailable. This was a
  deliberate availability choice; outages are logged.
- **I-2.** Sweep locks are released without an ownership check, so overlapping
  sweeps are possible. Work is idempotent (impact keys, notification
  de-duplication).
- **I-3.** PDF and video uploads are checked by signature only. They are
  served as attachments with `sandbox` CSP and nosniff. Room images are not
  re-encoded; they are private to participants.
- **I-4.** Overlapping jurisdictions can change each other's priority
  overrides. This is intentional for shared areas.
- **I-5.** Public organisation rosters show the names and platform roles of
  government office members. No contact details are shown.
- **I-6.** Unauthenticated AI `/health` reveals the provider and embedding
  model names. There are no keys or URLs.
- **I-7.** Request ids are not yet propagated through every background job
  and AI path.
- **I-8.** The remaining `npm audit` highs are all build/CLI-only, and no user
  input reaches them:
  - `braces` (no fixed version exists);
  - the `eslint-config-next` chain (lint);
  - the Prisma CLI's `deepmerge-ts` and `mysql2` (Prisma pins them exactly;
    MySQL is not used).
- **I-9.** The web CSP needs `'unsafe-inline'` for Next's inline bootstrap
  scripts. Nonce-based CSP is a later tightening.
- **I-10.** The access-token TTL is 15 minutes. Revocation is immediate
  because the session row is checked on every request.

## Accepted risks

- **L-20 (photos of hidden problems).** Keys are 128-bit random and are only
  ever shown with the problem. Deleting files on soft-delete conflicts with
  record retention (see the guidelines).
  - **Revisit:** when a CDN is introduced. Use a short, revalidating cache and
    move hidden problems' files to a private prefix.
- **L-21 (evidence buffering).** Bounded by rate limits (40 per 10 minutes).
  Streaming video to disk is part of the Prompt 27 performance work.
- **Owner action for M-8:** untrack `apps/api/.storage`. The five tracked
  images are synthetic test images with no EXIF metadata, but purging them
  from history is recommended before the repository is shared further.

## Controls verified as already correct

**Authentication**

- Argon2id with rehash-on-login, plus a constant-time dummy hash for unknown
  emails, so responses don't reveal whether an account exists.
- httpOnly, `SameSite=Lax` cookies; the refresh cookie is path-scoped.
- Hashed, rotated refresh tokens with reuse detection, which revokes every
  session for the user. Logout revokes server-side.

**Authorisation**

- Global `JwtAuthGuard`, `RolesGuard` and `RateLimitGuard` (routes are closed
  by default).
- `whitelist` + `forbidNonWhitelisted` validation, so role and status cannot
  be mass-assigned.
- Server-derived ownership and membership on every id-bearing route:
  rooms, projects, tasks, evidence, allocations, knowledge, notifications
  and comments.
- The jurisdiction predicate in every government query, including analytics,
  maps, exports and search.

**Data integrity**

- Append-only `audit_logs` and `impact_point_transactions`, enforced by
  database triggers.
- Idempotent awards.
- No client path can create notifications, points or badges.

**SQL, XSS and SSRF**

- **SQL:** parameterised `Prisma.sql` throughout. Sorts are enum-mapped,
  never interpolated.
- **XSS:** no `dangerouslySetInnerHTML`. User URLs are restricted to
  `http(s)`. Highlights are sent as text segments.
- **SSRF:** no user-controlled outbound requests. Knowledge URLs are stored,
  never fetched.

**Uploads**

- Detection is from content bytes. Storage keys are generated by the server,
  with a double traversal check. Files are served with sandbox CSP.

**AI**

- Output is schema-validated twice (Pydantic and the NestJS parsers).
- The AI service has no database access.
- The development provider is refused in production.
