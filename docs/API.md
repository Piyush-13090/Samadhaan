# API

Base URL: `http://localhost:4000/api/v1`

> Only the endpoints listed under [Implemented endpoints](#implemented-endpoints)
> exist. Nothing else is routed.

## Conventions

### Versioning

URI versioning. Every route is under `/api/{prefix}/{version}` — today
`/api/v1`. A breaking change introduces `/api/v2` alongside v1; adding a field
does not.

### Response envelope

Every successful response:

```json
{
  "success": true,
  "data": { },
  "meta": {
    "timestamp": "2026-09-12T08:31:32.869Z",
    "requestId": "4418deb9-94bb-406f-8072-d2b3f768f877",
    "version": "v1"
  }
}
```

Every failure:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": [{ "field": "email", "message": "email must be an email" }]
  },
  "meta": { "timestamp": "...", "requestId": "...", "version": "v1" }
}
```

`data` is the payload; controllers return plain objects and the envelope is
applied globally. `details` appears only on validation failures.

The shape is defined once in `apps/api/src/common/api-response.ts` and used by
the success interceptor, the exception filter and the unmatched-route handler,
so the three cannot drift. Types live in `@samadhaan/shared`.

### Error codes

Branch on `error.code`, not on HTTP status or message text.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Request body or query failed validation |
| `UNAUTHORIZED` | 401 | Authentication required or invalid |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `NOT_FOUND` | 404 | Resource or route does not exist |
| `CONFLICT` | 409 | Conflicts with current state |
| `RATE_LIMITED` | 429 | Too many requests |
| `UPSTREAM_UNAVAILABLE` | 503 | A dependency (AI service, storage) is unusable |
| `INTERNAL_ERROR` | 500 | Unexpected failure; details are logged, not returned |

### Correlation ids

Send `x-request-id` and it is used as-is; omit it and one is generated. Either
way it is returned in the `x-request-id` response header and in
`meta.requestId`, attached to every log line, and forwarded to the AI service —
so one id traces a request across all three services.

### Validation

Request bodies are validated with `class-validator`. Unknown fields are
**rejected**, not stripped: a client typo fails loudly rather than being
silently ignored.

### Pagination

List endpoints will use cursor pagination (`PaginationQueryDto`: `cursor`,
`limit`, default 20, max 100), returning:

```json
{ "items": [], "nextCursor": "opaque-string-or-null", "totalCount": 0 }
```

Cursors, not offsets: problem feeds are large and append-heavy, and an offset
page skips and repeats rows as new problems arrive mid-scroll.

---

## Implemented endpoints

### `GET /api/v1/health`

Full system health. Probes PostgreSQL, Redis and the AI service in parallel.

Always returns a report — a failing dependency is reported, never thrown.
Returns **200** when overall status is `ok` or `degraded`, **503** when `down`.

```bash
curl http://localhost:4000/api/v1/health
```

```json
{
  "success": true,
  "data": {
    "status": "degraded",
    "service": "samadhaan-api",
    "version": "0.1.0",
    "environment": "development",
    "uptimeSeconds": 17,
    "timestamp": "2026-09-12T08:31:32.869Z",
    "dependencies": [
      { "name": "database",  "status": "ok",       "latencyMs": 4 },
      { "name": "redis",     "status": "ok",       "latencyMs": 1 },
      { "name": "aiService", "status": "degraded", "latencyMs": 3,
        "message": "AI service is degraded: llmProvider, embeddingProvider" }
    ]
  },
  "meta": { "timestamp": "...", "requestId": "...", "version": "v1" }
}
```

**Status values**

| Value | Meaning |
| --- | --- |
| `ok` | Fully operational |
| `degraded` | Usable, but some capability is unavailable |
| `down` | Not usable |

**How the overall status is derived.** Each dependency is capped by how far it
can drag the system down: PostgreSQL can make the system `down`; Redis and the
AI service can only make it `degraded`, because reads and all non-AI features
still work without them. The overall status is the worst capped value.

The AI service's own verdict is passed through rather than flattened — a
reachable AI service with no LLM credentials is `degraded`, not `down`, and the
message names which of its providers are unconfigured.

### `GET /api/v1/health/live`

Liveness. Cheap, touches no dependencies — for container restart policies, which
should not restart the API because Redis is down.

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "samadhaan-api",
    "version": "0.1.0",
    "timestamp": "2026-09-12T08:31:32.869Z"
  },
  "meta": { "...": "..." }
}
```


---

## Authentication

### How it works

Two tokens, both delivered as `httpOnly` cookies and never present in a response
body:

| Cookie | Type | Lifetime | Path | Purpose |
| --- | --- | --- | --- | --- |
| `sam_access` | signed JWT | 15 min | `/` | Verified on every request, no database hit |
| `sam_refresh` | opaque random | 30 days | `/api/v1/auth` | Looked up in `sessions`; revocable |

Because they are `httpOnly`, JavaScript cannot read them — including any script
injected through an XSS hole. That is why tokens are never returned in JSON: a
token in `localStorage` is a credential any injected script can exfiltrate.

`SameSite=Lax` is the primary CSRF defence. It works because the browser reaches
the API on its own origin: Next.js proxies `/api/*` to NestJS, so these are
first-party cookies. Requests from another site do not carry them.

The refresh cookie is scoped to `/api/v1/auth`, so it is not attached to ordinary
API traffic.

### Errors

| Code | HTTP | Meaning |
| --- | --- | --- |
| `INVALID_CREDENTIALS` | 401 | Email or password wrong — **identical** for both |
| `SESSION_EXPIRED` | 401 | Missing, invalid, expired or revoked token — refresh, then sign in |
| `ACCOUNT_INACTIVE` | 403 | Authenticated but suspended |
| `RATE_LIMITED` | 429 | Too many attempts; see `retry-after` |

`INVALID_CREDENTIALS` is deliberately the same for an unknown email and a wrong
password, and the two paths take the same time, so the endpoint cannot be used
to discover which addresses are registered.

---

## Authentication endpoints

### `POST /api/v1/auth/register`

Creates a **citizen** account and signs in. Public. Rate limited to 5 per hour
per IP + email.

```json
{ "fullName": "Priya Sharma", "email": "priya@example.com", "password": "Monsoon-Drain-2026" }
```

`201` → `{ user, expiresIn }`, plus both auth cookies.

**Role cannot be chosen.** The DTO has no `role` field and validation rejects
unknown properties, so `{"role": "ADMIN"}` returns `400 VALIDATION_FAILED`.
Organisation and government accounts are created through verification and
invitation flows in later milestones.

| Error | HTTP | When |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Invalid input, weak password, or an unexpected field |
| `CONFLICT` | 409 | Email already registered |
| `RATE_LIMITED` | 429 | Too many attempts |

Password rules: at least 10 characters, not a common password, and not
containing the user's own name or email.

### `POST /api/v1/auth/login`

Public. Rate limited to 10 per 5 minutes per IP + email.

```json
{ "email": "priya@example.com", "password": "Monsoon-Drain-2026" }
```

`200` → `{ user, expiresIn }`, plus both auth cookies.

Errors: `INVALID_CREDENTIALS` (401), `ACCOUNT_INACTIVE` (403), `RATE_LIMITED` (429).

### `POST /api/v1/auth/refresh`

Exchanges the refresh cookie for a new token pair. Public — the access token is
expected to be expired by the time this is called.

`200` → `{ user, expiresIn }`, plus rotated cookies.

Refresh tokens are **single-use**. Presenting one twice is treated as theft:
every session for that user is revoked. Any failure returns `SESSION_EXPIRED`
(401) and clears the cookies.

### `POST /api/v1/auth/logout`

Revokes the session and clears both cookies. `204`.

Public, so an expired access token does not strand a user in a signed-in UI.
Revocation is real — a cookie captured before logout stops working immediately,
because the guard checks the session row on every request.

### `POST /api/v1/auth/logout-all`

Revokes every session for the current user. Requires authentication. `204`.

### `GET /api/v1/auth/me`

The current user. Requires authentication. Read from the database, not echoed
from token claims, so a profile change shows up immediately.

`200` → `AuthenticatedUser`:

```json
{
  "id": "uuid", "email": "priya@example.com", "fullName": "Priya Sharma",
  "displayName": "priya", "avatarUrl": null, "role": "CITIZEN",
  "status": "ACTIVE", "createdAt": "2026-01-01T00:00:00.000Z",
  "lastLoginAt": "2026-09-12T10:00:00.000Z", "emailVerifiedAt": null
}
```

`passwordHash` is never returned. The serializer is an explicit allow-list, so a
new database column is invisible until someone deliberately exposes it.

---

## User endpoints

### `GET /api/v1/users/me`

Same payload as `/auth/me`. Requires authentication.

### `PATCH /api/v1/users/me`

Updates the current user's own profile. Requires authentication.

```json
{ "fullName": "Priya Sharma", "displayName": "priya", "avatarUrl": "https://…" }
```

All fields optional. `200` → the updated `AuthenticatedUser`.

**Only these three fields exist on the DTO.** Sending `role`, `status` or
`email` returns `400 VALIDATION_FAILED`. The user id comes from the verified
token, never from the body or a path parameter, which rules out editing another
account by guessing its id.

`avatarUrl` must be an `http(s)` URL — a `javascript:` value would be stored XSS.

Errors: `VALIDATION_FAILED` (400), `SESSION_EXPIRED` (401), `CONFLICT` (409, display name taken).

### `GET /api/v1/users/count`

Total non-deleted users. **Requires the `ADMIN` role.**

Exists to demonstrate and test that `@Roles` is enforced by the backend. Any
other role gets `403 FORBIDDEN`, and the message does not name the required
role.


---

## Profile endpoints

### `GET /api/v1/users/me`

The signed-in user's own profile. Requires authentication.

`200` → `OwnProfile`:

```json
{
  "id": "uuid", "fullName": "Priya Sharma", "displayName": "priya",
  "avatarUrl": null, "bio": "Resident of Sector 12…", "role": "CITIZEN",
  "location": { "city": "Gurugram", "state": "Haryana", "country": "India" },
  "createdAt": "2026-08-02T09:00:00.000Z",
  "organizations": [
    { "organizationId": "uuid", "name": "Clean City Foundation",
      "slug": "clean-city-foundation", "type": "NGO",
      "verificationStatus": "VERIFIED", "logoUrl": null,
      "membershipRole": "OWNER", "joinedAt": "2026-08-12T09:00:00.000Z" }
  ],
  "email": "priya@example.com", "phone": null, "postalCode": null,
  "status": "ACTIVE", "emailVerifiedAt": "…", "lastLoginAt": "…"
}
```

The last five fields are the *own* view; they never appear in the public one.

### `GET /api/v1/users/me/activity`

Civic activity counts. Requires authentication.

```json
{
  "problemsReported": 2, "problemsSupported": 2, "commentsPosted": 0,
  "suggestionsMade": 0, "problemsResolved": 1, "impactPoints": null
}
```

**`null` is not zero.** Every number is counted from the database;
`impactPoints` is `null` because the ledger does not exist yet, and returning
`0` would misrepresent an unbuilt feature as a measured score. Clients render
`null` as "not yet available".

### `PATCH /api/v1/users/me`

Updates the signed-in user's own profile. Requires authentication.

Editable: `fullName`, `displayName`, `bio`, `avatarUrl`, `city`, `state`,
`country`, `postalCode`, `phone`. All optional; `null` clears an optional field,
an absent key leaves it untouched.

`200` → the updated `OwnProfile`.

**Not editable, and rejected with `400 VALIDATION_FAILED`:** `role`, `status`,
`email`, `emailVerifiedAt`, `passwordHash`, `createdAt`, impact fields. The DTO
has no such properties and validation rejects unknown ones, so this is a
property of the request shape rather than a check that could be forgotten.

The user id always comes from the verified token — never from the body or a path
parameter — which is what rules out editing another account by guessing its id.

| Error | HTTP | When |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Invalid value, or an unexpected field |
| `SESSION_EXPIRED` | 401 | Not signed in |
| `CONFLICT` | 409 | Display name already taken |

`avatarUrl` must be an `http(s)` URL — a `javascript:` value rendered into an
`src` would be stored XSS.

### `GET /api/v1/users/by-handle/:displayName`

A user's public profile. **Public** — civic contribution is a public record.

`200` → `{ profile: PublicProfile, activity: ProfileActivity }`.

`PublicProfile` omits email, phone, postal code, status and the login
timestamps. A suspended account returns `404`, the same as a missing one, so the
endpoint cannot be used to discover who is suspended.

---

## Organisation endpoints

### `GET /api/v1/organizations/:slug`

An organisation's public profile. **Public**.

`200` → `PublicOrganization`. Signed-in viewers additionally receive
`viewerPermissions`:

```json
{ "canEdit": true, "canManageMembers": true,
  "canManageExpertise": true, "canVerify": false }
```

That block is a **mirror** of the server's decision so the UI can hide unusable
controls. It is never the decision itself — every mutating endpoint re-derives
it server-side.

**Contact details (`email`, `phone`, `address`) are `null` unless the
organisation is `VERIFIED`**, or the viewer can edit it. An unverified profile
is an unchecked claim, and publishing contact details against one makes the
platform a vector for impersonation.

`404` for an unknown slug.

### `GET /api/v1/organizations/:id/members`

Team roster. **Public**. Returns public identity only — no email, phone or
account status. Managers additionally see `INVITED` memberships; the public view
shows only `ACTIVE` ones.

### `GET /api/v1/organizations/:id/activity`

`{ "suggestionsMade": 2, "suggestionsAccepted": 1, "problemsResolved": null }`.
`problemsResolved` is `null` until allocation exists.

### `GET /api/v1/organizations/:id/expertise`

**Public**. Areas the organisation works in.

### `PATCH /api/v1/organizations/:id`

Requires **OWNER or ADMIN membership, or platform ADMIN**.

Editable: `name`, `description`, `logoUrl`, `websiteUrl`, `email`, `phone`,
`address`, `city`, `state`, `country`, `postalCode`.

**Not editable:** `slug` (stable public URLs — see `docs/DATABASE.md` §14c),
`verificationStatus`, `verifiedAt`, `type`, `isActive`. An organisation marking
itself `VERIFIED` would make the badge meaningless.

| Error | HTTP | When |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Invalid value, or a non-editable field |
| `SESSION_EXPIRED` | 401 | Not signed in |
| `FORBIDDEN` | 403 | Not a manager of this organisation |
| `NOT_FOUND` | 404 | No such organisation |

403 covers both "not a member" and "a member without authority" — telling a
stranger an organisation exists but they lack the role maps the privileged
surface for them.

### `POST /api/v1/organizations/:id/expertise`

Requires OWNER/ADMIN or platform ADMIN. `201` → the entry.

```json
{ "category": "DRAINAGE", "subcategory": "Stormwater drainage", "level": "SPECIALIST" }
```

`category` must be a `ProblemCategory` — the same taxonomy problems use, so the
matcher can compare the two directly. Re-declaring an existing category
**updates** it rather than failing, which is what pressing *add* on something
already listed means.

### `DELETE /api/v1/organizations/:id/expertise/:expertiseId`

Requires OWNER/ADMIN or platform ADMIN. `204`. The expertise id is scoped to the
organisation, so an id belonging to another returns `404`.

### `PATCH /api/v1/organizations/:id/members/:memberId`

Requires OWNER/ADMIN or platform ADMIN. Body: `{ "membershipRole": "ADMIN" }`.

Refuses with `409 CONFLICT` when it would demote the **last OWNER** — an
organisation with no owner has nobody who can appoint one and becomes
permanently unmanageable.

### `DELETE /api/v1/organizations/:id/members/:memberId`

Requires OWNER/ADMIN or platform ADMIN. `204`. Marks the membership `LEFT`
rather than deleting it, so the organisation's membership history survives.
Refuses to remove the last OWNER.

> **Invitations are not implemented.** There is no email infrastructure yet. The
> extension point is `OrganizationMember.status = INVITED`, which already exists
> and is already rendered in the team list.


---

## Problem reporting

> **AI analysis runs separately.** A submitted problem is `SUBMITTED`, with its
> own `severity` and `urgency` at their schema defaults. Analysis happens in the
> background and is published on its own endpoints (see *AI analysis* below);
> it never writes back to the problem — AI recommends, a reviewer decides.
> Duplicate detection is still upcoming.

### The flow

Reporting is **two-phase**: images upload first, the report references them at
submission.

```
POST /problems/images   (multipart, one file)  ──▶ { storageKey, url, … }
        ⋮ repeated per photo
POST /problems          (JSON, storageKey[])   ──▶ ProblemView
```

Why two phases: a citizen needs previews and a progress bar before committing,
and a failed submit must not mean re-sending six photos over a phone
connection.

The cost is one question the system must answer — *may this person attach this
key?* An uploaded-but-unattached image is recorded in Redis against the
uploader's id, and submission refuses a key belonging to anyone else. Without
that, anyone could post a key from someone else's upload and claim their photo.

### `POST /api/v1/problems/images`

Uploads one image. Requires **CITIZEN or ADMIN**. `multipart/form-data`, field
name `file`.

`201` → `UploadedImage`:

```json
{
  "storageKey": "problems/2026/09/a3f2…c81.jpg",
  "url": "http://localhost:3100/api/v1/media/problems/2026/09/a3f2…c81.jpg",
  "contentType": "image/jpeg",
  "originalFileName": "photo.jpg",
  "sizeBytes": 248113, "width": 3024, "height": 4032
}
```

**Nothing the client says is trusted.** The filename, extension and
`Content-Type` header are all attacker-controlled, so the file is decoded and
its real format read from the bytes. A PHP script named `photo.jpg` with
`image/jpeg` in its header is rejected.

| Accepted | Rejected |
| --- | --- |
| JPEG, PNG, WebP | Everything else, including **SVG** — a document format that can carry script, and a stored-XSS primitive when served from our own origin |

Also enforced: 8 MB per file (multer *and* the validator), minimum 64×64,
maximum 100 megapixels (decompression bombs).

The storage key is **server-generated** — `problems/<year>/<month>/<32 hex>.<ext>`
— with the extension from the *detected* type. The original filename is kept as
metadata and never used as a path.

Errors: `VALIDATION_FAILED` (400), `SESSION_EXPIRED` (401), `FORBIDDEN` (403,
wrong role), `413` (over the byte limit).

### `POST /api/v1/problems`

Files a report. Requires **CITIZEN or ADMIN** — organisations and government act
*on* problems rather than filing them.

```json
{
  "title": "Waterlogging near the Sector 12 market entrance",
  "description": "Water has been standing at the market entrance for three days…",
  "category": "DRAINAGE",
  "subcategory": "Blocked drain",
  "location": {
    "latitude": 28.4595, "longitude": 77.0266,
    "address": "Sector 12 Market Road", "city": "Gurugram",
    "state": "Haryana", "postalCode": "122001", "accuracyMeters": 12
  },
  "images": [{ "storageKey": "problems/2026/09/a3f2…c81.jpg", "sortOrder": 0, "isPrimary": true }]
}
```

`201` → `ProblemView`, with `publicId` (`SAM-1023`), `status: "SUBMITTED"`.

**Not accepted, and rejected with `400`:** `status`, `severity`, `urgency`,
`priorityScore`, `publicId`, `reporterId`. Severity and urgency are assessments
the AI and a reviewer make; letting a reporter set them would make the triage
queue a measure of how alarmed people are rather than how bad things are. The
reporter is the id on the verified token.

| Validation | Rule |
| --- | --- |
| `title` | 8–140 characters |
| `description` | 20–2000. Shorter is rarely actionable — "road bad" cannot be triaged |
| `category` | A `ProblemCategory` value |
| `subcategory` | Optional, ≤ 80 characters, free text within the category |
| `location` | **Required.** Latitude −90..90, longitude −180..180 |
| `images` | Optional, ≤ 6. Each key must be unused and owned by the caller |

Images are optional: a citizen may be describing something they cannot safely
photograph, and refusing the report would lose information the platform exists
to collect.

**Atomic.** The problem and its images are written in one transaction. A report
that exists without the photo proving it is worse than no report — nothing
downstream can distinguish "no photo was taken" from "the photo was lost". If
creation fails, the uploaded objects are deleted.

Errors: `VALIDATION_FAILED` (400), `SESSION_EXPIRED` (401), `FORBIDDEN` (403).

### `GET /api/v1/problems/:publicId`

A problem by its reference, e.g. `SAM-1023`. **Public** — civic reports are a
public record.

The reporter is reduced to `{ id, name, avatarUrl }`. A civic report is public,
but the person who filed it did not thereby consent to publishing their email,
phone or account state. `DRAFT` problems are visible only to their reporter.

### `GET /api/v1/problems/mine`

The signed-in user's own reports, newest first. Requires authentication.

### `GET /api/v1/media/*key`

Serves a stored object. **Public**, and development-only: with an object store,
`getUrl` returns a signed CDN URL and this route disappears.

Hardened with `X-Content-Type-Options: nosniff` (stops a browser
re-interpreting the bytes as another type — the mechanism behind several
image-upload XSS attacks) and `Content-Security-Policy: default-src 'none';
sandbox`. Keys are validated three times: here, in the driver, and by the
driver confirming the resolved path stays inside its root.

---

## AI analysis

Analysis runs in the background. Filing a report returns immediately; the
analysis arrives seconds later and the client polls for it.

### `GET /api/v1/problems/:publicId/analysis`

The latest AI analysis for a problem. **Public**, like the problem itself —
resolved *through* the problem, so a `DRAFT` stays invisible to non-owners and
the analysis is not a way around that check.

Returns `null` (not 404) when no analysis exists. "This problem has no
analysis" is a normal state the UI renders, not an error — reports filed before
this capability existed are the realistic case.

```json
{
  "success": true,
  "data": {
    "id": "c2f...",
    "status": "COMPLETED",
    "category": "POTHOLES",
    "subcategory": "road surface cavity",
    "severity": "HIGH",
    "urgency": "HIGH",
    "severityScore": 7.5,
    "summary": "A deep pothole near a junction is a hazard to two-wheelers.",
    "confidence": 0.91,
    "observations": ["A cavity is visible in the road surface."],
    "modelName": "claude-opus-5",
    "textOnly": false,
    "errorMessage": null,
    "processingMs": 3100,
    "createdAt": "2026-09-13T10:00:00.000Z",
    "updatedAt": "2026-09-13T10:00:03.100Z"
  }
}
```

`status` is one of:

| Status | Meaning |
| --- | --- |
| `PENDING` | Queued. Written synchronously when the report is filed, so a client polling immediately finds a row. |
| `PROCESSING` | In flight with the provider. |
| `COMPLETED` | Findings are populated. |
| `FAILED` | `errorMessage` says why, in language safe to show a citizen. The report is unaffected. |

This is an allow-list projection, not the stored row. `rawResult` is never
published wholesale — only `observations` is lifted out of it, because that is
the part written for a citizen to read. The prompt and any private model
reasoning are neither requested nor stored.

**Polling contract.** The web client polls every 2s, stops on `COMPLETED` or
`FAILED`, and gives up after 60 polls (~2 minutes) so a stuck analysis cannot
leave a tab requesting forever. Polling rather than websockets: analysis
completes in seconds, each poll is one indexed read, and resolution rooms —
which genuinely need realtime — are a later milestone.

### `POST /api/v1/problems/:publicId/analyze`

Re-runs analysis. Returns **202 Accepted** with the newly queued analysis; the
client polls from there.

Restricted to the **reporter and platform admins**. Each call costs a paid model
invocation, so it is neither public nor open to any signed-in user. Government
re-analysis arrives with the review workflow.

| Caller | Result |
| --- | --- |
| Anonymous | `401` |
| Signed-in, not the reporter | `403` |
| Organisation account | `403` |
| Reporter or `ADMIN` | `202` |

Returns `409` when an analysis is already `PENDING` or `PROCESSING` for that
problem — a guard against a user hammering Retry and queueing several paid
calls.

Each retry writes a **new** `problem_ai_analyses` row rather than updating the
old one. Analyses are historical records tied to the model that produced them;
overwriting one would erase the evidence that a model regressed.

---

## AI service endpoints (internal)

`services/ai` is **not public**. The NestJS API is its only client. Documented
here for operators.

Base URL: `http://localhost:8001`

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Readiness report, consumed by the API's health module |
| `GET /health/live` | Liveness |
| `GET /docs` | OpenAPI UI (disabled when `NODE_ENV=production`) |
| `POST /analyze/problem` | Multimodal problem analysis. Requires `x-internal-token`. |

Health endpoints are intentionally unauthenticated so orchestrators can probe
them. Capability endpoints require the `x-internal-token` shared secret
(enforced whenever `AI_INTERNAL_TOKEN` is set).

### `POST /analyze/problem`

Request (snake_case — the Python service's own wire shape; translation happens
once, in `apps/api/src/ai/dto/analysis.dto.ts`):

```json
{
  "problem_id": "c1f...",
  "public_id": "SAM-1023",
  "title": "Waterlogging near the Sector 12 market entrance",
  "description": "Water has been standing for three days...",
  "category_hint": "DRAINAGE",
  "subcategory_hint": null,
  "locality": "Gurugram, Haryana",
  "images": [{ "media_type": "image/jpeg", "data": "<base64>" }]
}
```

Images are **inlined as base64, never as URLs**. The service fetches no remote
resource on a caller's behalf, which removes the SSRF surface entirely.
Coordinates are never sent — only coarse locality, and the prompt instructs the
model not to repeat it as fact.

Failure responses carry a structured body, and the `retryable` flag is what the
API's retry policy reads:

```json
{ "code": "PROVIDER_UNAVAILABLE", "message": "...", "retryable": false }
```

| Status | Codes |
| --- | --- |
| `401` | Missing or wrong `x-internal-token` |
| `422` | Request failed validation |
| `502` | `PROVIDER_ERROR`, `INVALID_MODEL_OUTPUT` |
| `503` | `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `RATE_LIMITED` |

Raw provider responses are never forwarded. When credentials are missing the
service returns `PROVIDER_UNAVAILABLE` with `retryable: false` — it does not
fabricate an analysis.

---

## Planned endpoints

Not implemented — listed so the URL surface is predictable.

| Area | Endpoints | Milestone |
| --- | --- | --- |
| Problems | `GET /problems` (feed, filtering, cursor pagination), `PATCH /problems/:id`, `DELETE /problems/:id` | Feed |
| Support | `POST /problems/:id/support`, `DELETE /problems/:id/support` | Community |
| Comments | `GET /problems/:id/comments`, `POST /problems/:id/comments` | Community |
| Suggestions | `GET /problems/:id/suggestions`, `POST /problems/:id/suggestions` | Community |
| Organisations | `GET /organizations` (directory), `POST /organizations`, `POST /organizations/:id/verify`, invitations | Organisations |
| Allocation | `POST /problems/:id/allocate` | Government |
| Resolution | `GET /resolution-rooms/:id`, `POST /resolution-rooms/:id/updates` | Resolution |
| Impact | `GET /leaderboard`, `GET /users/:id/impact` | Impact |
