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
`address`, `city`, `state`, `country`, `postalCode`, and `latitude` +
`longitude` — the registered location that defines the workspace service area.
Coordinates are set or cleared (`null`) **as a pair**; half a pair is `400`.
They are never published — the public profile shows city and state only.

Refused for members of a **suspended or deactivated** organisation (`403`); a
platform admin can still act on it. Every successful update writes an
`ORGANIZATION_PROFILE_UPDATED` audit entry recording the changed field
*names*, never their values.

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

Body: `{ "membershipRole": "ADMIN" }`. Requires OWNER/ADMIN or platform ADMIN,
then the role hierarchy:

| Rule | Response |
| --- | --- |
| Nobody changes **their own** membership (no self-promotion, no accidental self-demotion) | `403` |
| An ADMIN cannot change or remove an OWNER, and cannot make anyone OWNER | `403` |
| A MEMBER cannot change anyone | `403` |
| The last active OWNER is never demoted — not even by a platform ADMIN | `409` |
| The membership id belongs to another organisation | `404` |

The owner check locks the owner rows (`FOR UPDATE`) inside the write's
transaction, so two owners demoting each other at the same moment cannot leave
the organisation with none. Writes `ORGANIZATION_MEMBER_ROLE_CHANGED`.

### `DELETE /api/v1/organizations/:id/members/:memberId`

The same rules as a role change. `204`. Marks the membership `LEFT` rather than
deleting it, so the organisation's membership history survives. Also
withdraws a pending invitation. Writes `ORGANIZATION_MEMBER_REMOVED` or
`ORGANIZATION_INVITATION_WITHDRAWN`.

### `POST /api/v1/organizations/:id/invitations`

OWNER/ADMIN or platform ADMIN. Rate limited per user: 20 an hour.

```json
{ "email": "colleague@example.org", "membershipRole": "MEMBER" }
```

`membershipRole` is `ADMIN` or `MEMBER` — ownership is shared later by an
owner, never through an invitation a typo could send to a stranger. `201` →
the `OrganizationMemberSummary` with `status: "INVITED"`.

| Error | HTTP | When |
| --- | --- | --- |
| `NOT_FOUND` | 404 | No active account uses the email — ask them to register |
| `CONFLICT` | 409 | Already a member, already invited, or a suspended membership |

Inviting by email tells a manager whether the address has an account. That is
accepted for a manager-only, rate-limited action. There is no email delivery:
the invitee sees the invitation in `GET /organizations/mine`. A former member
is re-invited on their existing row.

---

## Organisation workspace

The workspace NGO, university and industry members work in. **Access comes from
membership, not from the platform role**, and is derived entirely from the
session — no endpoint accepts an organisation id or user id from the client to
decide access. Every `:slug` route runs `OrganizationWorkspaceGuard`:

```
signed in → organisation exists → type is NGO / UNIVERSITY / INDUSTRY
          → caller has an ACTIVE membership → organisation is operational
```

| Outcome | HTTP |
| --- | --- |
| Unknown slug, government office, not a member, membership not ACTIVE | `404` — indistinguishable on purpose |
| Member of a suspended (`verificationStatus = SUSPENDED`) or deactivated (`isActive = false`) organisation | `403`, with an explanation |
| Platform ADMIN who is not a member | `404` — the workspace is for members |

Slugs `mine` and `invitations` are reserved so these routes cannot be shadowed.

### `GET /api/v1/organizations/mine`

The caller's workspaces and pending invitations — the switcher's data.

```json
{
  "workspaces": [
    {
      "organizationId": "…", "slug": "clean-city-foundation", "name": "Clean City Foundation",
      "type": "NGO", "logoUrl": null, "verificationStatus": "VERIFIED",
      "membershipRole": "MEMBER", "isAccessible": true
    }
  ],
  "invitations": [
    {
      "membershipId": "…", "membershipRole": "ADMIN", "invitedAt": "2026-10-06T…",
      "organization": { "slug": "…", "name": "…", "type": "UNIVERSITY", "logoUrl": null, "verificationStatus": "PENDING" }
    }
  ]
}
```

Government offices are omitted. Suspended organisations stay listed with
`isAccessible: false`, so a member sees why rather than finding it gone.

### `POST /api/v1/organizations/invitations/:membershipId/accept` · `/decline`

`204`. The invitation is looked up by id **and** the caller's user id, so one
person cannot answer another's — that is the same `404` as a wrong id. Accepting
into a suspended organisation is `403`. Declining marks the row `LEFT`.

### `GET /api/v1/organizations/:slug/workspace`

The organisation (the `PublicOrganization` shape, contact details always
included for members), the caller's membership, `permissions` and the private
`coordinates`. Also serves the settings page.

```json
{
  "membership": { "id": "…", "membershipRole": "ADMIN", "joinedAt": "…" },
  "permissions": {
    "canEditProfile": true, "canManageExpertise": true, "canManageMembers": true,
    "assignableRoles": ["ADMIN", "MEMBER"]
  },
  "coordinates": { "latitude": 28.4595, "longitude": 77.0266 }
}
```

`permissions` mirrors the server's rules so the UI can hide controls; every
mutation re-checks.

### `GET /api/v1/organizations/:slug/dashboard`

One response for the whole dashboard. Every number is a database count.

| Field | Meaning |
| --- | --- |
| `metrics.opportunities` | Open problems in an area of work **and** in the service area |
| `metrics.newOpportunities` | Of those, reported in the last 7 days |
| `metrics.problemsSupportedByTeam` | Distinct problems supported by current active members |
| `metrics.suggestionsMade` / `suggestionsAccepted` | Suggestions made on the organisation's behalf |
| `metrics.teamMembers` | Active members |
| `metrics.pendingInvitations` | `null` unless the caller can manage the team |
| `opportunitiesByCategory` | Opportunity counts per declared area |
| `relevantProblems` | Top 4 opportunities, relevance order |
| `recentProblems` | Newest 4 open problems in the service area, any category |
| `teamSummary` | Active members by role, five most recent |
| `setup` | `hasExpertise`, `hasLocation` — what discovery is missing |

"Problems resolved" is deliberately absent: it needs allocation, a later
milestone.

### `GET /api/v1/organizations/:slug/problems`

Deterministic problem discovery, filtered, ordered and paginated in one
PostGIS query. **Not AI matching** — no model, no score, no LLM.

| Query | Values | Default |
| --- | --- | --- |
| `scope` | `all` · `relevant` (opportunities) | `all` |
| `sort` | `relevance` · `recent` · `severity` · `supported` · `distance` | `relevance` |
| `category` | a `ProblemCategory` | — |
| `subcategory` | 2–80 characters, matched literally (`%` and `_` escaped) | — |
| `severity` | `LOW` · `MEDIUM` · `HIGH` · `CRITICAL` | — |
| `status` | `SUBMITTED` · `UNDER_REVIEW` · `VERIFIED` · `IN_PROGRESS` · `RESOLVED` | the active statuses |
| `city` | exact, case-insensitive | — |
| `radiusMeters` | 500–50 000, from the organisation's registered location | — |
| `reportedWithinDays` | `1` · `7` · `30` · `90` | — |
| `page` | 1–200 | 1 |
| `limit` | 1–50 | 12 |

Anything else — including `organizationId` — is `400`. `radiusMeters` and
`sort=distance` are `400` when the organisation has no registered coordinates.

**Service area:** within 25 km (`ORGANIZATION_SERVICE_RADIUS_METERS`) of the
registered location; without coordinates, the registered city; without either,
everywhere (and the dashboard says so).

**Relevance order**, lexicographic so it can be stated in a sentence: problems
matching both an area of work and the service area first, then the declared
expertise level (specialist › experienced › interested), then severity, then
newest, then `publicId`.

```json
{
  "items": [
    {
      "publicId": "SAM-1005", "title": "…", "category": "DRAINAGE", "severity": "HIGH",
      "area": "Sector 12 Market", "distanceMeters": 37, "voteCount": 0, "…": "…",
      "relevance": {
        "reasons": ["EXPERTISE_MATCH", "SUBCATEGORY_MATCH", "IN_SERVICE_AREA"],
        "expertiseLevel": "SPECIALIST"
      },
      "ai": { "category": "DRAINAGE", "subcategory": "Blocked drain", "severity": "HIGH", "confidence": 0.94 }
    }
  ],
  "page": 1, "limit": 12, "totalCount": 3, "totalPages": 1,
  "origin": { "kind": "organization", "radiusMeters": null }
}
```

Items are the public feed shape (`ProblemListItem`): no reporter, no internal
id, no coordinates. `reasons` are checkable facts (`EXPERTISE_MATCH`,
`SUBCATEGORY_MATCH`, `IN_SERVICE_AREA`, `SAME_CITY`). `ai` is the latest
completed initial analysis' stored findings only — never `rawResult`, the
summary prompt, or any reasoning.

Team listing reuses `GET /organizations/:id/members` (managers also see pending
invitations); profile edits reuse `PATCH /organizations/:id`.

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

### `GET /api/v1/problems/my`

The signed-in user's own reports. Requires authentication. Cursor-paginated,
with status and category filters and four sort orders — see *Citizen dashboard
and discovery* below.

> Replaced `GET /problems/mine`, which returned an unpaginated array. The old
> path is gone rather than aliased.

### `GET /api/v1/media/*key`

Serves a stored object. **Public**, and development-only: with an object store,
`getUrl` returns a signed CDN URL and this route disappears.

Hardened with `X-Content-Type-Options: nosniff` (stops a browser
re-interpreting the bytes as another type — the mechanism behind several
image-upload XSS attacks) and `Content-Security-Policy: default-src 'none';
sandbox`. Keys are validated three times: here, in the driver, and by the
driver confirming the resolved path stays inside its root.

---

## Citizen dashboard and discovery

Three endpoints back the citizen home page and the explore feed. Deliberately
three and not a dozen: a dashboard that fans out to a request per section is
slowest on exactly the connection a civic app is used on.

### `GET /api/v1/dashboard/citizen`

Everything the home page needs, in one request. **Authenticated**, and scoped
entirely to the caller — the principal comes from the verified token and no
parameter can point it elsewhere.

```json
{
  "success": true,
  "data": {
    "user": {
      "name": "Priya Sharma",
      "firstName": "Priya",
      "city": "Gurugram",
      "state": "Haryana"
    },
    "activity": {
      "problemsReported": 7,
      "problemsSupported": 2,
      "commentsPosted": 0,
      "suggestionsMade": 0,
      "problemsResolved": 1,
      "impactPoints": null
    },
    "recentReports": [],
    "reportCount": 7
  }
}
```

Every count is read from the database. **`impactPoints` is `null`, not `0`** —
the ledger does not exist yet, and a zero would read as a measured score of
nothing rather than an unbuilt feature. The UI renders it as a dash labelled
"Coming soon".

Nearby problems are **not** included: they depend on a location only the browser
knows, so folding them in would mean either blocking the dashboard on a
permission prompt or returning a section the server cannot fill.

Not role-restricted. An admin or an organisation account still has their own
reports and their own activity; refusing them a home page would be arbitrary.

### `GET /api/v1/problems/nearby`

The discovery feed. **Public**, like every other read of a civic report. A
signed-in caller additionally gets `isOwnReport`, `supportedByCurrentUser` and
`followedByCurrentUser` on each row — the only things identity changes. It never
widens what is visible.

| Parameter | Default | Notes |
| --- | --- | --- |
| `latitude`, `longitude` | — | All-or-nothing; one without the other is a `400` |
| `radiusMeters` | `5000` | Bounded `100`–`50000` |
| `city` | — | Fallback origin, used only without coordinates |
| `category` | all | Must be a known `ProblemCategory` |
| `status` | active only | Must be a known `ProblemStatus` |
| `sort` | `relevance` | `relevance`, `distance`, `recent`, `severity`, `supported`, `discussed` |
| `limit` | `20` | Bounded `1`–`50` |
| `cursor` | — | Opaque; from the previous page's `nextCursor` |

`supported` orders by supporter count, newest first within a count.
`discussed` orders by the most recent comment and includes **only** problems
that have been discussed. Both are plain counts and timestamps — community
activity, not the AI priority engine.

```json
{
  "items": [
    {
      "publicId": "SAM-1023",
      "title": "Large pothole near Sector 12 market",
      "category": "POTHOLES",
      "subcategory": "Road surface failure",
      "status": "UNDER_REVIEW",
      "severity": "HIGH",
      "urgency": "HIGH",
      "area": "Main Market Crossing",
      "city": "Gurugram",
      "distanceMeters": 350,
      "voteCount": 214,
      "commentCount": 3,
      "thumbnailUrl": "http://localhost:3100/api/v1/media/...",
      "createdAt": "2026-09-10T00:00:00.000Z",
      "hasAiAnalysis": true,
      "isOwnReport": false
    }
  ],
  "nextCursor": "…",
  "origin": { "kind": "coordinates", "label": null, "radiusMeters": 5000 }
}
```

**Two search modes, and `origin` says which ran.**

- `coordinates` — PostGIS distance, real metres, ranked by proximity.
- `city` — the fallback. Profiles store city and state but deliberately **not**
  coordinates: a civic platform locates *problems* precisely, not people. A city
  search reports `distanceMeters: null` rather than inventing a number.
- `none` — neither given; the public feed, newest first.

**Privacy.** A feed shows many people's reports, so it carries civic facts and
nothing else. Absent by design and asserted by tests: the reporter, the internal
UUID (`publicId` is the only identity published), the email, the phone, and the
exact coordinates. `area` is the first address segment, not the full address —
the street address belongs on the problem's own page, not in a list that would
otherwise read as a directory of addresses.

**Eligibility.** `DRAFT` (never published) and confirmed duplicates (the reader
should be sent to the canonical report) are always excluded. Without an explicit
`status`, the feed is limited to live work — a feed led by resolved and archived
reports answers the wrong question for someone asking what needs attention.
`ARCHIVED` and `RESOLVED` remain reachable by asking for them: problems recur.

### `GET /api/v1/problems/my`

The citizen's own reports. **Authenticated.**

| Parameter | Default | Notes |
| --- | --- | --- |
| `status` | all | Must be a known `ProblemStatus` |
| `category` | all | Must be a known `ProblemCategory` |
| `sort` | `recent` | `recent`, `oldest`, `severity`, `status` |
| `limit` | `20` | Bounded `1`–`50` |
| `cursor` | — | Opaque |

Returns the standard paginated envelope: `{ items, nextCursor, totalCount }`.

**The identity cannot be redirected.** There is no `userId` parameter, the DTO
cannot express one, and the global `forbidNonWhitelisted` rejects an invented
one outright — `?userId=someone-else` is a `400`, not a leak. This is asserted
by tests for `userId`, `reporterId` and `user`.

### Discovery ranking

Transparent and hand-chosen. **This is not the AI priority engine**, which is a
later milestone; nothing here claims to be a learned model.

```
score = 0.45·proximity + 0.25·severity + 0.20·recency + 0.10·support
```

| Signal | Definition |
| --- | --- |
| Proximity | Linear decay to zero at the search radius. Omitted without an origin, so every row scores alike on it. |
| Severity | The reported band, evenly spaced: LOW `0.25` → CRITICAL `1.0`. |
| Recency | Exponential decay, 14-day half-life. |
| Support | Vote count, saturating at 50, so one popular report cannot dominate a feed. |

Support carries the least weight deliberately: it is the only signal a group of
people can drive up, and a feed one report dominates stops being discovery.

The whole expression is computed in SQL, because the order decides the page
boundary — ranking after pagination would page through one order and display
another. An explicit `sort` replaces the expression entirely.

**Pagination is keyset, and the ranking clock is pinned into the cursor.**
Recency decays against a reference time; letting each page use its own `now()`
makes a row's score drift between requests, and the boundary row is then
returned twice. Carrying the anchor also keeps the feed stable while a citizen
reads it, instead of re-ranking under them as they scroll.

### Caching

None of these are cached. The dashboard and `my` are per-user and must not be;
`nearby` is public but keyed on a continuous coordinate pair, so a cache would
mostly miss. Redis stays where it already earns its place — rate limiting and
pending uploads.

### Not in this milestone

| Capability | Milestone |
| --- | --- |
| Full-text and semantic search | Prompt 25 |
| AI priority engine | Prompt 21 — done for the government review queue, see [AI Priority Engine](#ai-priority-engine-prompt-21) |

Support, follow and comments landed in Prompt 10, notifications in Prompt 11 — see
[Community](#community--support-follow-and-discussion).

---

## Community — support, follow and discussion

Three separate things a citizen can do around a problem. **Support** and
**follow** are deliberately different signals:

| | Support | Follow |
| --- | --- | --- |
| Means | "This issue matters." | "Keep me posted about this issue." |
| Visibility | Public count, a civic signal | Count public; who follows is private |
| Drives | Priority and civic impact, later | Status-change notifications |

### Rules every community endpoint shares

- **The problem is resolved with the same visibility rule as the problem page.**
  A `DRAFT` is a `404` to everyone but its reporter, here as there.
- **Identity comes only from the session.** No route takes a user id in its
  path, query or body. Comment DTOs cannot express one, and the global
  `forbidNonWhitelisted` turns `userId`, `commentCount`, `isEdited` or
  `problemId` in a body into a `400`.
- **Counts are never accepted from the client.** Every response returns the
  server's own, and the UI displays those.
- **Reads are public; writes need a session** (`401` without one).
- **A confirmed duplicate is closed** to new support, follows and comments:
  `409`, with a message naming the canonical report. Withdrawing support or
  unfollowing is always allowed.

### Rate limits

Per **user**, not per IP — a campus NAT puts hundreds of legitimate citizens
behind one address. Fixed window on Redis; fails open, like the auth limiter.
Exceeding one returns `429 RATE_LIMITED` with `retry-after`.

| Bucket | Endpoints | Limit |
| --- | --- | --- |
| `engagement` | support / follow, add and remove | 60 per minute |
| `comment:create` | `POST …/comments` | 10 per minute |
| `comment:edit` | `PATCH` / `DELETE …/comments/:id` | 30 per minute |

### `GET /api/v1/problems/:publicId/engagement`

The problem page header in one read. **Public.** Viewer flags are `false` for an
anonymous caller.

```json
{
  "supportCount": 127,
  "supportedByCurrentUser": true,
  "followerCount": 23,
  "followedByCurrentUser": false,
  "commentCount": 12,
  "acceptsEngagement": true,
  "duplicateOfPublicId": null
}
```

Three counters read from the problem row plus two indexed existence checks — no
`COUNT(*)`.

### Support

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/v1/problems/:publicId/support` | Public | `SupportState` |
| `POST` | `/api/v1/problems/:publicId/support` | Session | `SupportState` (200) |
| `DELETE` | `/api/v1/problems/:publicId/support` | Session | `SupportState` (200) |

```json
{ "supportCount": 128, "supportedByCurrentUser": true }
```

**Idempotent.** Supporting twice leaves one support and returns the same state;
removing support you never gave is a no-op. Neither is an error, so a retried
request after a network blip needs no special case.

**Race-safe.** The insert is `ON CONFLICT DO NOTHING` against the
`(problemId, userId)` unique constraint, and the counter moves by the number of
rows actually inserted or deleted, in the same transaction. Eight simultaneous
requests from one user produce one support — asserted by the e2e suite.

The counter update does not touch the problem's `updatedAt`: support is not an
edit to the report.

### Follow

Same shape and guarantees as support, on `/follow`.

```json
{ "followerCount": 24, "followedByCurrentUser": true }
```

Filing a report **follows it on the reporter's behalf**, in the same
transaction, so Prompt 11's follower updates reach them too. They can unfollow.

### `GET /api/v1/problems/:publicId/comments`

**Public.** Paginated — never the whole discussion.

| Parameter | Default | Notes |
| --- | --- | --- |
| `limit` | `20` | Bounded `1`–`50` |
| `cursor` | — | Opaque; from `nextCursor` (or a thread's `repliesCursor`) |
| `parentCommentId` | — | List this comment's replies instead |

Without `parentCommentId`: **top-level comments, newest first**, each carrying
its first **3** replies (oldest first), the thread's `replyCount`, and a
`repliesCursor` when more exist. With it: that thread's replies, oldest first, so
a thread reads as a conversation.

```json
{
  "items": [
    {
      "id": "6f1c…",
      "body": "This road becomes very dangerous after rain.",
      "author": {
        "id": "…",
        "name": "piyush",
        "avatarUrl": null,
        "role": "CITIZEN",
        "isReporter": true
      },
      "parentCommentId": null,
      "createdAt": "2026-10-05T10:00:00.000Z",
      "isEdited": false,
      "isRemoved": false,
      "canEdit": false,
      "canDelete": false,
      "replies": [
        { "id": "…", "body": "Same issue near the next intersection.", "parentCommentId": "6f1c…", "…": "…" }
      ],
      "replyCount": 1,
      "repliesCursor": null
    }
  ],
  "nextCursor": null,
  "commentCount": 2
}
```

A page costs four queries however many comments it holds: the page, a
`ROW_NUMBER()` over each thread's replies (so one busy thread cannot load
hundreds of rows), those replies with authors, and per-thread counts. No N+1.

**Author privacy.** Name (display name where set) and avatar, the role, and
whether they filed the problem. Never the email or account state. A departed
account's comments keep their words but read as "Former member".

**`canEdit` / `canDelete`** are computed by the server for the viewer and drive
which controls the UI shows. They are a courtesy; every write re-checks.

### `POST /api/v1/problems/:publicId/comments`

**Session.** Returns `201` with `CommentMutationResult`.

```json
{ "body": "Same issue near the next intersection.", "parentCommentId": "6f1c…" }
```

```json
{ "comment": { "id": "…", "body": "…", "…": "…" }, "commentCount": 3 }
```

Validation — none of it trusts the client's own checks:

| Rule | Result |
| --- | --- |
| `body` missing or not a string | `400` |
| Fewer than 2 characters **after** normalisation | `400`, field `body` |
| More than 2000 characters after normalisation | `400`, field `body` |
| `parentCommentId` not a UUID | `400` |
| Parent does not exist, is on another problem, or was removed | `400`, field `parentCommentId` — one message for all three |
| Parent is itself a reply | `400` — threads are one level deep |

**Normalisation** trims, normalises line endings, collapses runs of blank lines,
and strips invisible control and bidi-override characters — so a body of only
those is "empty". It does **not** HTML-escape: comments are stored as written
and rendered as text, so `<script>` displays as those characters. The database
also enforces `length(btrim(body)) BETWEEN 1 AND 2000`.

### `PATCH /api/v1/problems/:publicId/comments/:commentId`

**Session; author only.** `{ "body": "…" }`. Updates the same row and sets
`isEdited`; saving unchanged text does not. Admins cannot edit others' comments
either — removing words is moderation, rewriting them is not.

### `DELETE /api/v1/problems/:publicId/comments/:commentId`

**Session; the author, or a platform `ADMIN`.** Soft delete: the row keeps its
content for moderation, and the API never returns it again. A removed top-level
comment that still has replies stays in the listing as a placeholder
(`isRemoved: true`, `body` and `author` null) so its replies keep their place;
without replies it disappears. Idempotent. An admin removing someone else's
comment writes an `AuditLog` entry (`COMMENT_REMOVED_BY_MODERATOR`).

| Caller | `PATCH` | `DELETE` |
| --- | --- | --- |
| Anonymous | `401` | `401` |
| The author | `200` | `200` |
| Another user | `403` | `403` |
| `ADMIN`, not the author | `403` | `200`, audited |
| Any caller, comment id from another problem's path | `404` | `404` |
| Malformed comment id | `400` | `400` |

The last row is the IDOR defence: a comment is looked up scoped to the problem
in the path, so a valid comment id cannot be used through another problem's URL.

### Events

Each successful write publishes a typed domain event — `PROBLEM_SUPPORTED`,
`PROBLEM_FOLLOWED`, `COMMENT_CREATED`, `COMMENT_REPLIED`, `COMMENT_REMOVED` —
**after** its transaction commits. Notifications are created from these; see
[Notifications](#notifications).

---

## Notifications

In-app notifications about the caller's own activity: their report was
analysed, supported, discussed or flagged as a possible duplicate; someone
replied to their comment; a problem they follow changed status.

**Every endpoint requires a session and is scoped to the caller.** The
recipient is always the authenticated user; no route accepts a recipient id in
its path, query or body, and the global whitelist turns `?recipientId=…` into a
`400`. Another person's notification id behaves exactly like a missing one — a
`404` for read, mark and delete alike, never a `403` that would confirm it
exists.

### Types

| Type | Sent to | When |
| --- | --- | --- |
| `AI_ANALYSIS_COMPLETED` | Reporter | An analysis job completes (once per job, after internal retries) |
| `AI_ANALYSIS_FAILED` | Reporter | An analysis job ends in failure |
| `POSSIBLE_DUPLICATE_FOUND` | Reporter | A duplicate check stores at least one `LIKELY_DUPLICATE` pair |
| `PROBLEM_SUPPORTED` | Reporter | Someone else supports their problem — once per supporter, ever |
| `PROBLEM_COMMENTED` | Reporter | Someone else comments or replies on their problem |
| `COMMENT_REPLIED` | Parent comment's author | Someone else replies to their comment |
| `PROBLEM_STATUS_CHANGED` | Reporter | Their problem's status changes, by someone else |
| `FOLLOWED_PROBLEM_UPDATED` | Followers (not the reporter, not the actor) | A followed problem's status changes |

Nobody is notified about their own action. A reporter who wrote the comment
being replied to receives the reply notification only, not a second
"comment on your problem". Supporters are never named — who supports what is not
shown anywhere else either.

### `GET /api/v1/notifications`

Newest first, cursor-paginated.

| Parameter | Default | Notes |
| --- | --- | --- |
| `filter` | `all` | `all` or `unread` |
| `limit` | `20` | Bounded `1`–`50` |
| `cursor` | — | Opaque; from `nextCursor` |

```json
{
  "items": [
    {
      "id": "b5e1…",
      "type": "COMMENT_REPLIED",
      "title": "New reply to your comment",
      "message": "arjun replied to your comment on SAM-1023.",
      "entityType": "COMMENT",
      "href": "/problems/SAM-1023#discussion",
      "problemPublicId": "SAM-1023",
      "isRead": false,
      "readAt": null,
      "createdAt": "2026-10-06T09:12:00.000Z"
    }
  ],
  "nextCursor": "…",
  "unreadCount": 5
}
```

**`href` is built by the server**, from validated metadata, on every read. It is
never stored, and it is always an in-app path: `/problems/:publicId`, with
`#discussion` for comments and replies and `#similar` for duplicates. A row
whose problem reference is missing or malformed links to `/notifications`
rather than nowhere.

Never returned: `recipientId`, the deduplication key, or raw metadata.

### `GET /api/v1/notifications/unread-count`

```json
{ "count": 5 }
```

One count on the `(recipientId, readAt)` index. The web app polls it once a
minute while the tab is visible and again when the tab regains focus.

### `PATCH /api/v1/notifications/:id/read`

Marks one read and returns it. Idempotent — a notification already read keeps
its original `readAt`. `404` if it is not the caller's.

### `PATCH /api/v1/notifications/read-all`

```json
{ "updated": 3, "unreadCount": 0 }
```

### `DELETE /api/v1/notifications/:id`

Deletes one of the caller's notifications. Returns `{ "unreadCount": n }`;
`404` if it is not theirs.

| Case | Result |
| --- | --- |
| No session | `401` on every endpoint |
| Malformed id | `400` |
| Another person's id | `404` |
| `?recipientId=` or any unknown parameter | `400` |
| `limit` outside `1`–`50`, unknown `filter`, bad cursor | `400` |

---

## Map and geocoding

### `GET /api/v1/problems/map`

Problems inside a map viewport, as GeoJSON. **Public**, and identical for every
caller — no viewer state — so it is sent with `Cache-Control: public, max-age=30`.

| Parameter | Required | Notes |
| --- | --- | --- |
| `west`, `south`, `east`, `north` | Yes | Degrees. `south < north`, `west < east`; each side at most **1.5°** |
| `category` | No | A `ProblemCategory` |
| `severity` | No | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` — the problem's recorded severity, not the AI's estimate |
| `status` | No | `SUBMITTED`, `UNDER_REVIEW`, `VERIFIED`, `IN_PROGRESS`, `RESOLVED`. Default: active work only |
| `limit` | No | `1`–`1000`, default `500` |
| `originLatitude`, `originLongitude` | No | Both or neither. Adds `distanceMeters`; never filters, never stored |

```json
{
  "type": "FeatureCollection",
  "bbox": [77.0, 28.4, 77.1, 28.5],
  "truncated": false,
  "features": [
    {
      "type": "Feature",
      "id": "SAM-1023",
      "geometry": { "type": "Point", "coordinates": [77.0266, 28.4595] },
      "properties": {
        "publicId": "SAM-1023",
        "title": "Large pothole near Sector 12 market",
        "category": "POTHOLES",
        "subcategory": "Road surface failure",
        "severity": "HIGH",
        "status": "SUBMITTED",
        "area": "Sector 12 Market Road",
        "city": "Gurugram",
        "voteCount": 214,
        "createdAt": "2026-09-10T00:00:00.000Z",
        "distanceMeters": 350
      }
    }
  ]
}
```

- Coordinates are GeoJSON order, **`[longitude, latitude]`**, rounded to five
  decimals (about a metre).
- Ordered most severe first. When more problems match than `limit`, the most
  severe are kept and `truncated` is `true` — zoom in for the rest.
- Never included: drafts, confirmed duplicates, the reporter, the internal id,
  the full street address (`area` is its first segment).
- `400` for a missing or out-of-range edge, an inverted or antimeridian box, a
  box larger than 1.5°, an unknown filter value, an internal status (`DRAFT`,
  `DUPLICATE`…), or any unknown parameter.

### `GET /api/v1/problems/map/aggregate`

The same viewport and filters (no `limit`, no origin), up to **40°** a side,
answered as a grid of cells — the basis for future hotspot work. **Public**,
`Cache-Control: public, max-age=60`.

```json
{
  "type": "FeatureCollection",
  "bbox": [68, 8, 97, 37],
  "cellSizeDegrees": 2,
  "totalCount": 10,
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [77.02727, 28.4611] },
      "properties": {
        "count": 10,
        "severity": { "LOW": 0, "MEDIUM": 5, "HIGH": 4, "CRITICAL": 1 },
        "topCategories": [{ "category": "DRAINAGE", "count": 3 }]
      }
    }
  ]
}
```

A cell sits at the centroid of its problems, not its corner. The grid size is
chosen from the viewport (about 16 cells across). It is counting on a grid, not
a statistical hotspot model.

### Radius queries

"Within 1 / 5 / 10 km" is `GET /api/v1/problems/nearby` with `latitude`,
`longitude` and `radiusMeters` (see *Citizen dashboard and discovery*) —
`ST_DWithin` and `ST_Distance` on geography.

### `GET /api/v1/geo/search?q=…&limit=5`

Place search — a city, locality or address. **Session required**; rate limited
to 30 per minute per user.

```json
[
  {
    "label": "Sector 12, Gurugram, Haryana, 122001, India",
    "latitude": 28.4595,
    "longitude": 77.0266,
    "address": "Market Road, Sector 12",
    "city": "Gurugram",
    "state": "Haryana",
    "postalCode": "122001",
    "country": "India",
    "boundingBox": [77.01, 28.45, 77.04, 28.47]
  }
]
```

`q` is 2–200 characters; `limit` 1–8. Results are limited to
`GEOCODING_COUNTRY_CODES` (default `in`).

### `GET /api/v1/geo/reverse?latitude=…&longitude=…`

The address at a point, for the report location picker; `null` where there is
none. Same session requirement and limit.

**Geocoding behaviour.** The browser never calls the geocoder: the API does, so
provider keys stay on the server, results are cached in Redis for a day (search
text hashed; reverse lookups on a ~11 m grid), and the provider's own rate limit
sits behind ours. When the provider is down or `GEOCODING_PROVIDER=none`, both
return **`503`** with a message telling the user to move the map or type the
address — every flow that uses geocoding has a manual path.

---

## Government portal (Prompt 15)

Review and civic intelligence for a government office, inside its
jurisdiction. Full design: [`GOVERNMENT_PORTAL.md`](./GOVERNMENT_PORTAL.md).

**Every route** requires the platform role `GOVERNMENT` (`403` otherwise —
including for `ADMIN`). Every `:slug` route also requires an ACTIVE membership
of that `GOVERNMENT` organisation (`404` otherwise) and an operational office
(`403` when suspended), and every query applies the office's jurisdiction
predicate: a problem outside it is `404`. Filters narrow inside the
jurisdiction; nothing the client sends widens it.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/government/mine` | The caller's offices |
| GET | `/government/:slug/context` | Office, jurisdiction (type, name, basis, bbox), membership, permissions |
| GET | `/government/:slug/dashboard?range=7\|30\|90` | `metrics`, `trend`, `reviewQueue` (6), `recentActivity` (8) |
| GET | `/government/:slug/activity` | Latest 30 audit entries in the jurisdiction |
| GET | `/government/:slug/problems` | Review queue / all reports, filtered and paginated |
| GET | `/government/:slug/problems/:publicId` | Full review detail |
| PATCH | `/government/:slug/problems/:publicId/status` | Review transition |
| POST | `/government/:slug/problems/:publicId/notes` | Internal note |
| GET | `/government/:slug/problems/:publicId/audit` | The problem's audit timeline |
| GET | `/government/:slug/map` · `/map/aggregate` | Viewport GeoJSON, jurisdiction-scoped |

### `GET /government/:slug/problems`

| Query | Values | Default |
| --- | --- | --- |
| `view` | `queue` (SUBMITTED + UNDER_REVIEW) · `all` | `queue` |
| `status` | any `ProblemStatus` but `DRAFT` | — |
| `severity`, `category` | taxonomy | — |
| `subcategory`, `area` | 2–80 / 2–120 characters, literal match | — |
| `city` | exact, case-insensitive | — |
| `reportedFrom`, `reportedTo` | ISO dates, inclusive | — |
| `duplicate` | `possible` · `confirmed` · `none` | — |
| `aiStatus` | `completed` · `pending` · `failed` · `none` | — |
| `q` | 2–120: reference (exact), title, description, address, category | — |
| `sort` | `queue` · `newest` · `oldest` · `severity` · `supported` | `queue` |
| `page`, `limit` | 1–500, 1–50 | 1, 20 |

Items are the feed shape plus `followCount`, `ai { status, category,
subcategory, confidence }` and `duplicates { possible, confirmedOf }`. No
reporter, no internal id.

### `PATCH /government/:slug/problems/:publicId/status`

```json
{ "status": "VERIFIED", "note": "Problem verified by municipal review team." }
```

Allowed: `SUBMITTED → UNDER_REVIEW`, `UNDER_REVIEW → VERIFIED`,
`UNDER_REVIEW → REJECTED` (note required). `VERIFIED → IN_PROGRESS` happens
only by an organisation accepting an allocation (Prompt 16). `200 { status,
allowedTransitions }`.

| Error | HTTP | When |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Unknown status, note too long, rejecting without a reason |
| `NOT_FOUND` | 404 | Outside the jurisdiction, draft, or no such problem |
| `CONFLICT` | 409 | Transition not allowed from the current status, or someone else changed it first |

Writes `PROBLEM_STATUS_CHANGED` to the audit log (from, to, note, office) and
publishes the existing event — the reporter and followers are notified; the
note is not included.

### `POST /government/:slug/problems/:publicId/notes`

`{ "body": "Site inspection required before allocation." }` (2–2000
characters) → `201` note. Visible only through this office's portal; never on
any public endpoint. Audited by id.

### Map

The public viewport parameters, plus `status` (any but DRAFT), `severity`,
`category`, `duplicate` (`possible`/`none`), `aiStatus`, `reportedWithinDays`
(7/30/90) and `limit`. Same response shapes as `/problems/map`.

---

## Impact points, reputation and leaderboard (Prompt 23)

Design: [`IMPACT_POINTS.md`](./IMPACT_POINTS.md),
[`REPUTATION_SYSTEM.md`](./REPUTATION_SYSTEM.md).

- **Points are created only by the server:** by its award rules on confirmed
  outcomes, and by audited administrator adjustments.
- **No endpoint writes points or badges** for the caller, and bodies cannot
  carry them.

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/users/me/impact?filter=all\|reports\|community\|projects\|resolutions\|bonuses&page&limit` | Signed in | `ImpactSummary`: `impactPoints`, `resolvedContributions`, `tier`, paginated ledger `items` (amount, type, reason, problem publicId and title, `ruleVersion`, time) |
| GET | `/users/me/reputation` | Signed in | `ReputationView`: `score` 0–100, `tier`, `next`, `impactPoints`, `verifiedReports`, `successfulContributions`, `resolvedContributions`, `note`. No negative signals |
| GET | `/users/me/badges` | Signed in | Every active badge with `earned` and `awardedAt` |
| GET | `/users/me/contributions?page&limit` | Signed in | Resolved problems the user is credited for, with roles and points |
| GET | `/leaderboard?period=week\|month\|year\|all&city&state&category&page&limit (≤ 50)` | Public | `LeaderboardPage`: ranked `items` (rank, public name, display name, avatar, points, reputation score and tier, resolved contributions, up to 3 badges, `isViewer`); `viewer` (the caller's own row, if ranked); totals. Aggregated in SQL; cached 60 s |
| POST | `/admin/users/:id/impact/adjust` | Platform ADMIN | `{ amount (±1–1000, not 0), reason (10–500) }` → `{ impactPoints }`. Writes a new `ADMIN_ADJUSTMENT` transaction plus an `IMPACT_POINTS_ADJUSTED` audit entry. `403` for anyone else, and for one's own account |

**Also changed:**
- `GET /users/me/activity` and the dashboard's `activity.impactPoints` are now
  the real total (they were `null`).
- New notification types `IMPACT_POINTS_AWARDED`, `BADGE_EARNED` and
  `REPUTATION_TIER_REACHED`, linking to `/profile/impact`.
- New per-user rate limits:

  | Action | Limit |
  | --- | --- |
  | `POST /problems` | 20 per hour |
  | `POST /problems/images` | 100 per hour |
  | Duplicate confirm / reject | 30 per 10 min |

---

## Civic analytics (Prompt 24)

Detail: [`ANALYTICS_ARCHITECTURE.md`](./ANALYTICS_ARCHITECTURE.md),
[`ANALYTICS_METRICS.md`](./ANALYTICS_METRICS.md),
[`CIVIC_HOTSPOTS.md`](./CIVIC_HOTSPOTS.md).

**Common query** for every analytics read:

| Parameter | Values |
| --- | --- |
| `preset` | `7d` · `30d` (default) · `90d` · `6m` · `1y` · `custom` |
| `from`, `to` | `YYYY-MM-DD` local dates, for `custom`. From ≤ to, not in the future, at most 731 days. Giving both without a preset implies `custom` |
| `timezone` | An IANA zone. Default `ANALYTICS_TIMEZONE` |
| `category`, `severity`, `status`, `priority` | Enum filters (`status` excludes DRAFT; `priority` is the effective tier) |
| `city` | Case-insensitive, at most 100 characters |
| `area` | A postal code |

- **Errors:** an invalid zone, range or unknown parameter gives `400
  VALIDATION_FAILED`.
- **Response envelope:** each response includes `period` (resolved dates,
  zone, granularity, previous period), `filters` and `generatedAt`.
- **Unavailable values are `null`.**

### Government — `/api/v1/government/:slug/analytics/…`

Government officials of that office only (`GovernmentGuard`). Every query is
limited to the office's jurisdiction.

| Endpoint | Returns |
| --- | --- |
| `GET overview` | Reported, verified, in progress, resolved, rejected, critical/high, resolution rate, avg/median days to verification and resolution, active now. Each with `previous` and `changePct` |
| `GET trends` | Buckets (`day`/`week`/`month`) of reported, verified, resolved and rejected events |
| `GET categories` | Category counts, share, previous-period change, direction, persistence; subcategories (minimum group 3); severity and priority distributions |
| `GET areas` | Jurisdiction total; by state, city and postal code, with groups under 3 suppressed |
| `GET resolution` | Summary (avg, median, fastest, longest waiting, rate, returned verifications), cumulative funnel with conversions, stage durations, bottleneck, time-to-resolution distribution, by priority and by severity |
| `GET community` | Active contributors, verified reports, duplicates, supported reports, contributions to resolution, points earned, outcomes |
| `GET hotspots` | `grid-zscore-v1`: `cells` (`MapAggregateCell[]`, at least 3 per cell, rounded) and scored `hotspots` |
| `GET recurring` | `dbscan-300m-14d-v1` clusters (3+ reports, 2+ people, 14+ days, duplicates excluded) |
| `GET insights` | `{ insight }`: the cached summary for exactly this period and filters, or `null` |
| `POST insights` | Generates a summary (rate-limited, 10 per hour). `facts` (observed), `summary`/`observations`/`attention` citing fact keys (AI interpretation), `guidance`/`guidanceNotes` (reference knowledge, PUBLIC only), and `model.aiRan`. Returns 503 if the AI service fails; 403 if insights are disabled |
| `GET export?dataset=overview\|trends\|categories\|areas\|resolution\|problems&format=csv\|json` | A file download. `problems` has public fields only and at most `ANALYTICS_EXPORT_MAX_ROWS` rows. Formula-safe CSV. Rate-limited (30 per hour). Audited as `ANALYTICS_EXPORTED` |

Citizens and organisation members get 403. Officials of another office get
404.

### Organisation — `GET /api/v1/organizations/:slug/analytics`

- **Members only** (`OrganizationWorkspaceGuard`); everyone else gets 404.
  Takes `preset`/`from`/`to`/`timezone`.
- **Returns:** problems accepted, active and completed projects, average
  duration, on-time rate (with observations), tasks completed, open tasks,
  evidence submitted, evidence approval rate, resolutions approved, and a
  completion trend.
- **No ranking or comparison** with other organisations.

### Citizen — `GET /api/v1/users/me/analytics`

The caller's own reports, all time: reported, verified, in progress, awaiting
review, resolved, confirmed duplicates, median days to resolution, supporters
across their reports, and impact points.

### AI service: `POST /analytics/insights` (internal)

- **Request:** `{ scope, period_label, facts[{key,label,value,signal?}] (1–60),
  guidance[{ref,title,text}] (≤3) }`.
- **Returns:** `summary`, `observations`/`attention` (`text`, `metric_keys`),
  `guidance_notes` (`text`, `refs`), `ai_ran`, the model and prompt versions,
  and `dropped_statements`.
- **Statements are dropped** when they cite unknown facts, use numbers not in
  the facts, or state causes.

## Resolution verification (Prompt 22)

Completion evidence and the government's verification decision. Design:
[`RESOLUTION_VERIFICATION.md`](./RESOLUTION_VERIFICATION.md). Security:
[`EVIDENCE_SECURITY.md`](./EVIDENCE_SECURITY.md).

- **Access** to evidence and project verification is the project's. Anyone
  outside it gets `404`.
- **Decisions** are government-portal routes, for the allocating office only.
- **The AI review is advisory.** Only an approval resolves a problem.

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/resolution-projects/:id/evidence` | Participants | `EvidenceView[]`. Drafts only for the organisation |
| POST | `/resolution-projects/:id/evidence` | Assigned-organisation members | `{ evidenceType, title (1–200), description? (≤ 4000), replacesEvidenceId? }` → `201` DRAFT. No ids, status or ownership accepted (`400`). `409` unless the project is active or paused and the problem in progress. 30 per 10 min |
| GET | `/resolution-projects/:id/verification` | Participants | `ProjectVerificationView`: evidence, pending `request`, `history`, `missingEvidence`, `timeline`, `canSubmitEvidence`, `canRequestVerification`, `requestBlockers`, `limitations` |
| POST | `/resolution-projects/:id/verification/request` | Organisation OWNER/ADMIN | `{ note? }` → view. AI-reviewed and returned evidence moves to UNDER_GOVERNMENT_REVIEW. `409` while a review is running, with nothing reviewed, or with a request already pending. 5 per 10 min |
| GET | `/evidence/:id` | Participants | `EvidenceView`: files (API URLs, distance, capture time; no storage key, no raw GPS), latest `assessment`, `permissions` |
| POST | `/evidence/:id/files` | Draft author or OWNER/ADMIN | Multipart `file` plus optional `role` (BEFORE, AFTER, DOCUMENT, OTHER) → `201` view. The type is detected from the bytes and the extension must match. Images 10 MB, PDF 10 MB, MP4 50 MB, 8 files maximum. Images are stored without EXIF. 40 per 10 min |
| DELETE | `/evidence/:id/files/:fileId` | Draft author or OWNER/ADMIN | Drafts only |
| POST | `/evidence/:id/submit` | Draft author or OWNER/ADMIN | DRAFT → SUBMITTED, and the AI review is queued. `400` without a file (except a progress update with a description) |
| POST | `/evidence/:id/withdraw` | Submitter or OWNER/ADMIN | Before government review. `409` otherwise |
| POST | `/evidence/:id/analyze` | OWNER/ADMIN or the allocating office | `202`. Runs the AI review again; never changes the lifecycle status. 5 per 10 min |
| GET | `/evidence/:id/files/:fileId` | Participants | The file, with `nosniff`, `CSP: sandbox` and `private, no-store` |
| GET | `/government/:slug/problems/:publicId/verification` | Officials in jurisdiction | `GovernmentVerificationView`: problem and report photos, project progress, evidence, AI roll-up (advisory; conflicts flagged), missing evidence, request history, timeline, `canDecide`, `approvalBlockers`, limitations. Another office gets `project: null` and no evidence |
| POST | `/government/:slug/problems/:publicId/verification/approve` | The allocating office | `{ note? }`. One transaction: problem → RESOLVED (`resolvedAt`), project → COMPLETED, evidence → APPROVED. `409` with open tasks, nothing pending, or a concurrent decision. 20 per 10 min |
| POST | `/government/:slug/problems/:publicId/verification/reject` | The allocating office | `{ reason (10–2000) }`. Evidence → REJECTED; the problem and project are unchanged |
| POST | `/government/:slug/problems/:publicId/verification/request-evidence` | The allocating office | `{ reason (10–2000) }`. Evidence → NEEDS_MORE_EVIDENCE |

**Also changed:**
- `POST /resolution-projects/:id/status { COMPLETED }` now returns `409`,
  because completion happens through verification. `allowedTransitions` no
  longer lists COMPLETED.
- The public `GET /problems/:publicId` gains `resolution { resolvedAt,
  verifiedBy }` once approved, and `assignment.progress` (0–100).
- New notification types: `RESOLUTION_EVIDENCE_SUBMITTED`,
  `RESOLUTION_EVIDENCE_REVIEWED`, `RESOLUTION_VERIFICATION_REQUESTED`,
  `RESOLUTION_MORE_EVIDENCE_REQUESTED`, `RESOLUTION_APPROVED`,
  `RESOLUTION_REJECTED`. The reporter's existing `PROBLEM_STATUS_CHANGED`
  notification now has RESOLVED wording.
- `/media/evidence/…` is refused (`404`).
- **AI service (internal, token-guarded):** `POST /verify/evidence` takes a
  bounded context with images (base64) and PDF documents (base64). It returns
  four signals (value or null, plus confidence), a `recommendation` in
  INSUFFICIENT_EVIDENCE, POSSIBLY_RESOLVED, LIKELY_RESOLVED or
  LIKELY_NOT_RESOLVED (or null when no model ran), `confidence`, cited
  `supporting` and `remaining_issues`, and versions. It never returns
  "RESOLVED".

---

## AI Priority Engine (Prompt 21)

Advisory, explainable priority for government review. Design:
[`AI_PRIORITY_ENGINE.md`](./AI_PRIORITY_ENGINE.md).

- **Government routes** use the portal's existing authorisation: role
  GOVERNMENT, active membership of an operational office (`GovernmentGuard`),
  and the problem inside that office's jurisdiction.
- **Outside the jurisdiction is `404`,** the same as a problem that does not
  exist.
- **Admin is not a government official** here either, so admins get `403`.

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/government/:slug/problems/:publicId/priority` | Officials in jurisdiction | `GovernmentPriorityView`: `assessment` (`score` 0–100, `tier`, `confidence`, `dataCompleteness`, `provisional`, `reasons[]` driver/warning/info, `breakdown[]` per feature `value`/`confidence`/`available`/`weight`/`contribution`/`source`/`evidence`/`note`, `model` versions and `aiStatus`, PUBLIC `guidance[]`, `calculatedAt`, `confirmedAt`) or null; `override` (tier, reason, office, official, time, AI tier/score then) or null; `effective { tier, source: AI \| OVERRIDE }`; `history[]` (score, tier, time, trigger, `changes`); `canOverride`. **Never runs the pipeline** |
| POST | `/government/:slug/problems/:publicId/priority/recalculate` | Officials in jurisdiction | `{ refreshAi? }` → view. Runs the pipeline now; AI features are reused unless the report changed or `refreshAi`. `409` for a problem that is not assessable. 10 per 10 min |
| POST | `/government/:slug/problems/:publicId/priority/override` | Officials in jurisdiction | `{ tier: CRITICAL\|HIGH\|MEDIUM\|LOW, reason (10–1000) }` → view. Creates or updates the override; never edits the AI assessment. Audited `PRIORITY_OVERRIDE_CREATED` / `_UPDATED`. 30 per 10 min |
| DELETE | `/government/:slug/problems/:publicId/priority/override` | Officials in jurisdiction | `{ reason? }` → view. Audited `PRIORITY_OVERRIDE_REMOVED`. `404` if none |
| GET | `/problems/:publicId/priority` | Anyone who may see the problem | `PublicPriorityView { level, reasons[], assessedAt }`. Only once verified, else `level: null`. No score, confidence, override or reason |

**Also changed:**
- **`GET /government/:slug/problems`:**
  - `sort` gains `priority` (effective tier, then score, then longest
    waiting; unassessed last) and `urgency`;
  - new filter `priority=CRITICAL|HIGH|MEDIUM|LOW|UNASSESSED`, on the
    effective tier;
  - each item gains `priority { tier, aiTier, score, overridden, confidence,
    dataCompleteness, provisional, summary[] }`.
- **Activity and audit entries** gain the kinds `PRIORITY_OVERRIDE_*`, with
  `fromPriority` and `toPriority`.
- **New notification type `PRIORITY_ESCALATED`.** Officials of every office
  whose jurisdiction covers the problem are told when the AI tier newly
  becomes CRITICAL, unless an override exists. It links to `#priority`.
- **AI service (internal, token-guarded):** `POST /priority/features` takes
  `{ problem_id, title, description, category, subcategory?, severity?,
  urgency?, analysis_summary?, observations[], locality? }` and returns
  `{ safety_risk, urgency, impact_breadth: { value 0–1|null, confidence,
  evidence[] }, stated_affected, ai_ran, provider, model_name, model_version,
  prompt_version }`. It never returns a score.

---

## Knowledge & RAG (Prompt 20)

Retrieval-augmented answers over civic knowledge. Design:
[`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md),
[`KNOWLEDGE_MODEL.md`](./KNOWLEDGE_MODEL.md),
[`RAG_SECURITY.md`](./RAG_SECURITY.md).

- **Access.** Every endpoint requires a session. Lists, sources, passages,
  files and answers are filtered **in SQL** to what the caller may read. A
  source, problem or project the caller cannot see is `404`, exactly as if
  it did not exist.
- **Evidence, not authority.** No endpoint verifies, allocates or changes a
  project.

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| POST | `/knowledge/query` | Signed in | `{ query (3–1000), contextType?: 'GENERAL' \| 'PROBLEM' \| 'PROJECT', problemId? (SAM-…), projectId?, topK? (1–12), mode?: 'answer' \| 'retrieve' }` → `KnowledgeAnswerView`: `answer`, `insufficientEvidence`, `weakRetrieval`, `suggestions` (labelled as the model's), `sources[]` (`ref`, `sourceId`, `documentId`, `chunkId`, `title`, `sourceType`, `sectionTitle`, `pageNumber`, `relevanceScore`, `excerpt`, `href`, `cited`), `model`, `retrieval` versions. No passages → "does not contain enough information" with **no model call**. `404` for a problem or project you cannot see; `503` when retrieval or the model is unavailable (recorded as FAILED). 20 per minute |
| GET | `/knowledge/authoring` | Signed in | The visibilities the caller may publish to, with the offices, organisations and projects for each |
| GET | `/knowledge/sources?page&limit&q&status&sourceType&manageable&projectId` | Signed in | `KnowledgeSourcePage` of readable sources. PROJECT sources appear only with a `projectId` the caller participates in |
| POST | `/knowledge/sources` | See `KNOWLEDGE_MODEL.md` §3 | `{ title, description?, sourceType, visibility, organizationId?, projectId?, externalUrl?, content?, categories?, city? }` → `201`; indexing is queued when `content` is given. `403` for a scope you may not publish to; ownership and pipeline fields are rejected (`400`). 30 per 10 min |
| GET | `/knowledge/sources/:id` | Readers | `KnowledgeSourceView`, including `status`, `failureMessage`, `chunkCount`, embedding and chunker versions, and `permissions` |
| GET | `/knowledge/sources/:id/chunks` | Readers | Every passage, in order (`id`, `chunkIndex`, `content`, `sectionTitle`, `pageNumber`, `tokenCount`). Never embeddings |
| PATCH | `/knowledge/sources/:id` | Managers | `{ title?, description?, sourceType?, categories?, city?, externalUrl?, content? }`; new `content` re-indexes. Visibility and owner are immutable |
| DELETE | `/knowledge/sources/:id` | Managers | `204`; documents, chunks and the stored file are removed; audited |
| POST | `/knowledge/sources/:id/ingest` | Managers | Re-index or retry → `202`. `409` while processing. 10 per 10 min |
| POST | `/knowledge/sources/:id/file` | Managers | Multipart `file` (PDF, text, Markdown or HTML; ≤ 10 MB; type checked from the bytes) → `202`, queued. 10 per 10 min |
| GET | `/knowledge/sources/:id/file` | Readers | The original, as an attachment with `nosniff` and `CSP: sandbox`; HTML as `text/plain` |

**Also changed:**
- `/media/knowledge/…` is refused (`404`).
- Coordinator findings may cite `{ kind: 'knowledge' }` sources.
- **AI service (internal, token-guarded):**
  - `POST /knowledge/chunk`: `{ text | file_base64, mime_type?, max_tokens, overlap_tokens, min_tokens, max_chunks }`
    → chunks with section, page and content hash. `422` for unreadable
    documents.
  - `POST /knowledge/answer`: `{ question, application_context[], evidence[] (ref, title, section, content) }`
    → `{ answer, insufficient_evidence, evidence_refs, suggestions, model…, prompt_version, dropped_citations }`.

---

## AI Project Coordinator (Prompt 19)

Advisory insights over a project. Full design:
[`AI_PROJECT_COORDINATOR.md`](./AI_PROJECT_COORDINATOR.md). Access is the
project's (its room's): anyone else gets `404`. **No endpoint changes tasks,
milestones or project status.**

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/resolution-projects/:id/ai-coordinator` | Participants | `CoordinatorView`: live deterministic `health { level, reasons, signals }`, rule `risks`/`blockers`, `deadlines`; cached `insight` (summary, AI risks and blockers, suggestions, `generatedAt`, `expiresAt`, `stale`, `model { provider, name, version, promptVersion }`) or null; `lastFailure`; `questions`; `refreshAvailableAt`; `canRefresh`/`canAnswer`/`canPostUpdates`. **Never calls the model** |
| POST | `/resolution-projects/:id/ai-coordinator/refresh` | Participants | Runs the analysis now → `CoordinatorView`. `429` within the per-project cool-down (120 s) or over 5 per user per 10 min; `503` when the AI is unavailable or its output unusable (a FAILED insight is recorded, and the previous one kept); `409` for a finished project |
| POST | `/resolution-projects/:id/ai-coordinator/questions/:questionId/answer` | Participants | `{ quick?: 'COMPLETED' \| 'NOT_YET', answer? }` (an answer is needed unless `quick`; ≤ 1000) → view. `409` if not open |
| POST | `/resolution-projects/:id/ai-coordinator/questions/:questionId/dismiss` | Org OWNER/ADMIN, officials | → view |
| POST | `/resolution-projects/:id/ai-coordinator/extract-update` | Assigned organisation | `{ text? , fromRecentMessages? }` → `ExtractedUpdateView` (`confidence: null`, `model`). **Saves nothing.** 10 per 10 min |
| GET | `/resolution-projects/:id/updates?cursor` | Participants | Structured updates, newest first, 20 per page |
| POST | `/resolution-projects/:id/updates` | Assigned organisation | `{ summary, completed?, current?, blockers?, nextSteps?, source?: 'MANUAL' \| 'AI_ASSISTED', aiModel? }` → `201` |

**Also changed:**
- New notification types `PROJECT_COORDINATOR_ALERT` and
  `PROJECT_COORDINATOR_QUESTION`.
- The room-event type `PROJECT_UPDATE_POSTED`.
- **AI service (internal, token-guarded):**
  - `POST /coordinator/analyze`: `CoordinatorRequest` → `CoordinatorResult`.
  - `POST /coordinator/extract-update`: `{ text, project_name? }` →
    `ExtractUpdateResult`.

---

## Resolution projects (Prompt 18)

The deterministic plan inside a room. Full design:
[`PROJECT_MANAGEMENT.md`](./PROJECT_MANAGEMENT.md).

**Access is the room's access:** the allocating office's officials and the
assigned organisation's active members. Anyone else gets `404`. Within that:
- The organisation's OWNER/ADMIN manage the plan.
- MEMBERs move their own assigned tasks.
- Government reads, and may edit the project's name and description.

Edits carry `version`; a stale one is a `409`.

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/resolution-rooms/:id/project` | Participants | `ProjectView`: project, problem, both organisations, `overview` (task counts, progress, milestones), `viewer`, `permissions { canManage, canUpdateOwnTasks, isEditable, allowedTransitions }`, `today` |
| GET | `/resolution-projects/:id` | Participants | Same shape |
| PATCH | `/resolution-projects/:id` | Managers; government for name and description | `{ version, name?, description?, startDate?, targetDate? }` (dates `YYYY-MM-DD`; target ≥ start; start not after open due dates) |
| POST | `/resolution-projects/:id/status` | Managers | `{ status, reason? }`. Reason required for `CANCELLED`; `COMPLETED` needs no open tasks |
| GET | `/resolution-projects/:id/assignees` | Participants | Active members of the assigned organisation |
| GET | `/resolution-projects/:id/tasks` | Participants | Filters: `status` (comma list), `priority` (comma list), `assignee` (`<id>`, `me` or `unassigned`), `milestoneId`, `overdue=true`, `dueBefore`, `dueAfter`, `page`, `limit` (≤ 200). Ordered by due date, priority, then creation |
| POST | `/resolution-projects/:id/tasks` | Managers | `{ title, description?, priority?, assignedToId?, dueDate?, milestoneId? }` → `201 TaskView` |
| GET | `/resolution-projects/:id/tasks/:taskId` | Participants | `TaskView` with the viewer's `allowedTransitions` and `canEdit` |
| PATCH | `/resolution-projects/:id/tasks/:taskId` | Managers | `{ version, …details }`. Open tasks only. Status is not editable here |
| POST | `/resolution-projects/:id/tasks/:taskId/status` | Managers; the assignee for start, block and complete | `{ status }`. The task state machine applies; starting work on a PLANNED project activates it |
| POST | `/resolution-projects/:id/tasks/:taskId/attachments` | Managers; the assignee | `{ attachmentId }` — a file in this room's store |
| DELETE | `/resolution-projects/:id/tasks/:taskId/attachments/:attachmentId` | Managers; the assignee | Unlinks the file (the file itself stays) |
| GET | `/resolution-projects/:id/milestones` | Participants | Derived `status`, task counts and `progress` |
| POST | `/resolution-projects/:id/milestones` | Managers | `{ title, description?, dueDate? }` → the list |
| PATCH | `/resolution-projects/:id/milestones/:milestoneId` | Managers | `{ version, title?, description?, dueDate? }` |
| POST | `/resolution-projects/:id/milestones/:milestoneId/complete` · `/reopen` | Managers | Complete needs no open tasks in it |
| GET | `/resolution-projects/:id/activity?cursor` | Participants | Project events, newest first, 30 per page |

**Errors:**
- `400`: validation, unknown fields, an assignee outside the organisation, a
  due date before the start, an invalid milestone, or a file outside the room.
- `403`: the role does not allow it.
- `404`: not a participant, or not in this project.
- `409`: a transition that is not allowed, a stale version, a race lost,
  open tasks blocking completion, or a read-only project or room.
- `429`: too many writes (60 per minute).

**Also changed:**
- Accepting an allocation also creates the project.
- The government dashboard gains `metrics.activeProjects` and `projects`.
- The organisation dashboard gains `projects` ("My active projects").
- The room's activity endpoint returns room events only.
- New notification types: `PROJECT_TASK_ASSIGNED`, `PROJECT_TASK_DUE_SOON`,
  `PROJECT_TASK_COMPLETED`, `PROJECT_MILESTONE_COMPLETED` and
  `PROJECT_STATUS_CHANGED`, with the entity type `RESOLUTION_PROJECT`.
- Tasks are cancelled, never deleted, so there is no `DELETE` on tasks.

---

## Resolution rooms (Prompt 17)

Private collaboration between the allocating office and the assigned
organisation. Full design: [`RESOLUTION_ROOMS.md`](./RESOLUTION_ROOMS.md).

Every `:id` route resolves the caller's access first:
- **Government side:** role `GOVERNMENT`, ACTIVE member of the allocating
  office, the office is operational, and the problem is inside its
  jurisdiction.
- **Organisation side:** ACTIVE member of the assigned organisation.

Anyone else gets `404`, `401` without a session, and `400` for a malformed id.
Author, room, organisation and side are never accepted from the client.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/resolution-rooms` | Rooms the caller participates in, with `unreadCount` |
| GET | `/resolution-rooms/:id` | `ResolutionRoomView`: problem context, government, organisation, allocation, `viewer { side, canPost, canClose, homePath }`, `unreadCount`. The first visit records `PARTICIPANT_JOINED` |
| GET | `/resolution-rooms/:id/participants` | Active members of both sides: name, avatar, role, joined |
| GET | `/resolution-rooms/:id/messages?cursor&limit` | Keyset on `(createdAt, id)`; `{ items (oldest first), nextCursor }`; limit 1–100 (default 30) |
| POST | `/resolution-rooms/:id/messages` | `{ body, mentionUserIds?, attachmentIds? }` → `201`. 1–4000 chars; ≤ 10 mentions (participants only); ≤ 4 own unsent attachments. 20/min |
| PATCH | `/resolution-rooms/:id/messages/:messageId` | `{ body }`. Own, live messages; room open. 30/min |
| DELETE | `/resolution-rooms/:id/messages/:messageId` | Soft delete, own messages. `204` |
| POST | `/resolution-rooms/:id/read` | Marks read up to now → `{ unreadCount }` |
| GET | `/resolution-rooms/:id/activity` | Allocation, acceptance and room events. No message text |
| GET | `/resolution-rooms/:id/attachments` | Attachments on live messages (plus your unsent uploads) |
| POST | `/resolution-rooms/:id/attachments` | Multipart `file`: JPEG/PNG/WebP/PDF by content, ≤ 10 MB, extension must match → `201`. 10 per 10 min |
| GET | `/resolution-rooms/:id/attachments/:attachmentId/file` | The bytes, after the room check. `nosniff`, `CSP: sandbox`, `private` cache |
| POST | `/resolution-rooms/:id/close` | `{ reason }` (3–1000). Allocating office only (`403` otherwise); `409` if already closed |
| GET | `/resolution-rooms/:id/stream` | `text/event-stream`: `message.created`, `message.updated`, `activity`, `room.closed`. Re-checks access every 60 s and ends after 15 min |

| Error | HTTP | When |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Empty or too-long body, unknown fields, bad cursor, a refused file, an attachment that is not yours |
| `FORBIDDEN` | 403 | Changing someone else's message; the organisation closing; a suspended organisation |
| `NOT_FOUND` | 404 | Not a participant (any reason); a message or attachment outside the room |
| `CONFLICT` | 409 | Room closed; message already deleted |
| `RATE_LIMITED` | 429 | Posting, editing, uploading or closing too fast |

**Also changed:**
- Accepting an allocation now opens the room in the same transaction.
- `GovernmentAllocationView` and the organisation's allocation items and
  detail gain `roomId`.
- The government and organisation dashboards gain `openRooms`.
- `/media/*` refuses `resolution/` keys.
- New notification types `RESOLUTION_MESSAGE`, `RESOLUTION_MENTION` and
  `RESOLUTION_ROOM_CLOSED`, with the entity type `RESOLUTION_ROOM`.

---

## Government allocation (Prompt 16)

An official assigns a verified problem to an eligible organisation, which
accepts or declines. Full design: [`ALLOCATION.md`](./ALLOCATION.md).

Government routes have the same guards as the portal (role `GOVERNMENT`,
office membership, operational office, jurisdiction). Organisation routes are
workspace routes (ACTIVE membership by slug; `404` otherwise). The office, the
official and the responding member always come from the session.

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/government/:slug/problems/:publicId/allocations` | Official | `GovernmentAllocationPanel`: `canAllocate`, `blockedReason`, `active`, `history` (newest first), `candidates` (top 10 matches with eligibility), `verifiedAt`. Also embedded as `allocation` in the problem detail |
| GET | `/government/:slug/problems/:publicId/allocation-candidates?q=` | Official | Up to 20 NGO/university/industry organisations by name (2–80 chars), with match evidence if any, `eligible`, `ineligibleReason`, `previouslyDeclined` |
| POST | `/government/:slug/problems/:publicId/allocations` | Official | `{ organizationId, instructions?, internalReason? }` (notes ≤ 1000) → `201 GovernmentAllocationView`. Rate limit 60/min |
| POST | `/government/:slug/allocations/:id/cancel` | Allocating office | `{ reason? }` → `200`; pending only |
| GET | `/organizations/:slug/allocations?view=pending\|active\|past\|all&page&limit` | Member | `OrganizationAllocationPage`; `pending` is the default |
| GET | `/organizations/:slug/allocations/:id` | Member | `OrganizationAllocationDetail` — no `internalReason`; `canRespond` |
| POST | `/organizations/:slug/allocations/:id/accept` | OWNER/ADMIN | `{ note? }` → `200`; problem becomes `IN_PROGRESS` in the same transaction |
| POST | `/organizations/:slug/allocations/:id/decline` | OWNER/ADMIN | `{ reason }` (3–1000, required) → `200`; problem stays `VERIFIED` |

| Error | HTTP | When |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Malformed body, unknown fields (e.g. `governmentOrganizationId`), decline without a reason, ineligible or unknown organisation |
| `FORBIDDEN` | 403 | Not a government official; organisation `MEMBER` responding |
| `NOT_FOUND` | 404 | Problem outside the jurisdiction; another office's allocation; another organisation's allocation |
| `CONFLICT` | 409 | Problem not `VERIFIED`; an active allocation exists; "Another official allocated this problem moments ago."; "This allocation was already responded to by another authorized user."; "This allocation was withdrawn by the government office."; cancelling a decided allocation |

**Also changed:**
- `GET /problems/:publicId` adds `assignment: { organization { slug, name,
  type, logoUrl }, assignedAt } | null`, present only for an accepted
  allocation.
- The government dashboard adds `pendingAllocations`, `acceptedAllocations`
  and `declinedAllocations`.
- The organisation dashboard adds `pendingAllocations` and
  `activeAssignments`.
- Government activity entries gain the kinds `ALLOCATION_CREATED`,
  `ALLOCATION_ACCEPTED`, `ALLOCATION_DECLINED` and `ALLOCATION_CANCELLED`, an
  `organizationName`, and the actor kind `ORGANIZATION`.
- Notifications gain the types `ALLOCATION_REQUESTED`, `ALLOCATION_ACCEPTED`,
  `ALLOCATION_DECLINED` and `ALLOCATION_CANCELLED` (entity type
  `ALLOCATION`).

---

## Organisation matching (Prompt 14)

AI-assisted matching of problems to organisations that **may be able to help**.
A match is a suggestion, never an assignment. Relevance is a weighted score
from an embedding-assisted heuristic baseline — not a probability. Method:
[`ML_ORGANIZATION_MATCHING.md`](./ML_ORGANIZATION_MATCHING.md).

No endpoint accepts a score: matches are written only by the background job.

### `GET /api/v1/problems/:publicId/matches?limit=5`

Public. `limit` 1–10. `404` for an unknown or draft problem.

```json
{
  "state": "ready",
  "matchingVersion": "heuristic-baseline@1.0.0+77c1d02",
  "computedAt": "2026-10-06T10:52:37.982Z",
  "items": [
    {
      "relevance": 0.723,
      "rank": 1,
      "signals": {
        "semantic": 0.392, "expertise": 1, "category": 1,
        "geographic": 1, "capability": 0.041, "activity": 0.667
      },
      "reasons": [
        { "code": "EXPERTISE_STRONG", "value": 1 },
        { "code": "WITHIN_SERVICE_AREA", "value": 0 }
      ],
      "matchedExpertise": [
        { "category": "DRAINAGE", "subcategory": "Stormwater drainage", "level": "SPECIALIST" }
      ],
      "computedAt": "…",
      "organization": {
        "slug": "clean-city-foundation", "name": "Clean City Foundation", "type": "NGO",
        "logoUrl": null, "verificationStatus": "VERIFIED",
        "location": { "city": "Gurugram", "state": "Haryana" }
      }
    }
  ]
}
```

`state`: `ready`; `pending` (no matches yet and a run is queued or has not
happened); `unavailable` (not open work — a duplicate, resolved, rejected — or
matching switched off). Only public organisation facts are returned. Suspended,
rejected or deactivated organisations, government offices and dismissed matches
are never listed. Reason codes: `EXPERTISE_STRONG`, `EXPERTISE_RELATED`,
`SEMANTIC_HIGH`, `SEMANTIC_MODERATE`, `WITHIN_SERVICE_AREA` (value: metres),
`SAME_CITY`, `IN_REGION` (metres), `TYPE_FIT`, `RELATED_ACTIVITY` (value: count).

### `POST /api/v1/problems/:publicId/matches/recompute`

Platform `ADMIN` only (`403` otherwise, `401` signed out). Rate limited 30 a
minute. `202 { "queued": true }` — the job runs in the background.

### `GET /api/v1/organizations/:slug/recommendations`

Workspace guard (active member of an operational organisation; `404`
otherwise). The problem-discovery item shape plus `match`:

| Query | Values | Default |
| --- | --- | --- |
| `sort` | `relevance` · `recent` · `severity` · `distance` | `relevance` |
| `view` | `active` · `dismissed` | `active` |
| `category`, `severity`, `city`, `radiusMeters`, `reportedWithinDays`, `page`, `limit` | as for `/problems` | — |
| `minRelevance` | 0–1 | — |

```json
{
  "items": [
    {
      "publicId": "SAM-1005", "title": "…", "severity": "HIGH", "distanceMeters": 37, "…": "…",
      "match": {
        "relevance": 0.76, "rank": 1, "status": "CALCULATED",
        "signals": { "…": "…" }, "reasons": [ … ], "matchedExpertise": [ … ], "computedAt": "…"
      }
    }
  ],
  "page": 1, "limit": 12, "totalCount": 5, "totalPages": 1,
  "origin": { "kind": "organization", "radiusMeters": null }
}
```

### `POST /api/v1/organizations/:slug/recommendations/:publicId/dismiss` · `/restore`

OWNER or ADMIN of that organisation (`403` for a MEMBER, `404` for a
non-member or no such recommendation). `204`. Dismissing marks the match "not
relevant" for this organisation only; it survives re-matching and hides it from
the public list. Restoring shows it again (status `STALE` until the next run).
Both are audited (`ORGANIZATION_RECOMMENDATION_DISMISSED` / `_RESTORED`). There
is no accept, apply or assign.

The organisation dashboard (`GET /organizations/:slug/dashboard`) gains
`recommendations: { total, items }` — the top four.

### AI service: `POST /match/organizations` (internal)

Internal token only; called by the API, never the browser. Input: the
problem's taxonomy and public text, and per candidate its type, expertise,
pgvector similarity, distance, same-city flag and activity count. Output:
ranked matches with signals, reason codes and matched-expertise indexes; the
engine name, version, matching version, weights and `trained: false`; and any
`degraded` signals. `422` for invalid input.

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

## Duplicate detection

Runs in the background on submit, like analysis. Filing a report returns
immediately; the check arrives seconds later and the client polls for it.

### `GET /api/v1/problems/:publicId/similar`

Problems that may already describe the same issue. **Public**, like the problem
itself, and resolved *through* the problem so a `DRAFT` stays invisible to
non-owners — a similarity endpoint must not become a way to enumerate
unpublished reports.

```json
{
  "success": true,
  "data": {
    "status": "COMPLETED",
    "comparedCount": 12,
    "errorMessage": null,
    "checkedAt": "2026-09-13T10:00:04.000Z",
    "candidates": [
      {
        "candidateId": "b81f...",
        "problem": {
          "publicId": "SAM-1023",
          "title": "Large pothole near Sector 12 market",
          "category": "POTHOLES",
          "subcategory": "Road surface failure",
          "status": "UNDER_REVIEW",
          "city": "Gurugram",
          "createdAt": "2026-09-10T00:00:00.000Z",
          "voteCount": 214,
          "thumbnailUrl": "http://localhost:3100/api/v1/media/..."
        },
        "similarity": 0.91,
        "confidence": 0.78,
        "distanceMeters": 350,
        "verdict": "LIKELY_DUPLICATE",
        "status": "LIKELY_DUPLICATE",
        "signals": {
          "text": 0.91,
          "image": null,
          "geographic": 0.97,
          "category": 1,
          "temporal": 0.88
        },
        "evidence": [
          { "id": "text-strong", "label": "Describes a very similar problem" },
          { "id": "category", "label": "Same civic category" },
          { "id": "geo", "label": "Reported nearby" }
        ]
      }
    ]
  }
}
```

`status` reuses the analysis lifecycle (`PENDING` / `PROCESSING` / `COMPLETED` /
`FAILED`). `COMPLETED` with an empty `candidates` array means the check ran and
found nothing — distinct from `PENDING`, which means it has not run.

**`verdict` vs `status`.** `verdict` is what the *algorithm* claims, derived from
the score: `LIKELY_DUPLICATE`, `POSSIBLE_DUPLICATE` or `RELATED`. `status` is
what a *person* decided about the stored pair. Conflating them would turn an
algorithm's opinion into a record of human judgement.

**A `null` signal means unavailable, not zero.** `image` is always null today —
there is no image encoder, and the scorer renormalises its weights rather than
inventing a value. See [`ML_DUPLICATE_DETECTION.md`](./ML_DUPLICATE_DETECTION.md) §6.

**Raw vectors are never returned**, and are not even loaded by this path. An
embedding reconstructs its source text well enough that publishing the corpus
would let anyone probe the similarity space offline.

Polling: every 2s, stopping on a terminal status, capped at 60 polls.

### `POST /api/v1/problems/:publicId/duplicates/:candidateId/confirm`

Records that this report describes the same issue as the candidate. Restricted
to the **reporter and platform admins** — marking someone's report a duplicate is
a judgement about their submission, not a community action.

The pair becomes `CONFIRMED_DUPLICATE`, the newer problem gets `duplicateOfId`
and status `DUPLICATE`, and an `AuditLog` entry records who decided and the score
at that moment. **Neither report is deleted.** Transferring supporters and
comments onto the canonical report is a *merge*, and is a later milestone.

Returns the updated check, in the same shape as `GET /similar`.

### `POST /api/v1/problems/:publicId/duplicates/:candidateId/reject`

Records that the two reports are different problems. The pair becomes
`NOT_DUPLICATE` and is withdrawn from the UI but **kept** — confirmed negatives
are the scarcer half of the training data a learned scorer will need, and
deleting them would also mean re-suggesting the same rejected pair.

### `POST /api/v1/problems/:publicId/duplicates/analyze`

Re-runs the check. **202 Accepted**; the client polls from there. Reporter and
admins only. `409` while a check is already in flight.

### Authorisation, all four endpoints

| Caller | `GET /similar` | confirm / reject / analyze |
| --- | --- | --- |
| Anonymous | `200` | `401` |
| Signed-in, not the reporter | `200` | `403` |
| Organisation account | `200` | `403` |
| Reporter or `ADMIN` | `200` | `200` / `202` |

A `candidateId` belonging to a different problem returns `404` — identical to a
missing pair, so the endpoint does not confirm which ids exist.

Similarity is **never accepted from the client**. The global validation pipe runs
`forbidNonWhitelisted`, so a request body carrying `combinedScore`, `confidence`,
`textSimilarity` or `duplicateOfId` is rejected with `400`.

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
| `POST /embeddings/text` | Text embedding generation. Requires `x-internal-token`. |
| `POST /knowledge/chunk`, `POST /knowledge/answer` | Knowledge extraction and chunking; evidence-only answers. Require `x-internal-token`. |
| `POST /verify/evidence` | Advisory evidence review with images and documents — never a decision. Requires `x-internal-token`. |
| `POST /priority/features` | Bounded priority signals with confidence and grounded evidence — never a score. Requires `x-internal-token`. |

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

### `POST /embeddings/text`

Encodes text into vectors for duplicate detection. Internal only: exposing it
would let anyone mine the vector space, and let a caller generate vectors this
service never wrote.

```json
{ "texts": ["Large pothole near Sector 12 market"] }
```

Response:

```json
{
  "embeddings": [{ "index": 0, "embedding": [0.0123, -0.0456, "..."] }],
  "provider": "sentence-transformers",
  "model_name": "sentence-transformers/all-MiniLM-L6-v2",
  "model_version": "sentence-transformers/6.0.1",
  "dimensions": 384,
  "normalized": true,
  "processing_ms": 41
}
```

A batch of 1–64 texts; encoding is dominated by model overhead, so ten texts in
one call cost far less than ten calls.

`model_name`, `model_version` and `dimensions` must all be stored with the
vector. Vectors from different models are not comparable, and a cosine computed
across them is a plausible-looking number with no meaning.

| Status | Codes |
| --- | --- |
| `400` | `INVALID_INPUT`, `DIMENSION_MISMATCH` |
| `401` | Missing or wrong `x-internal-token` |
| `422` | Request failed validation (empty or oversized batch) |
| `502` | `PROVIDER_ERROR` |
| `503` | `PROVIDER_UNAVAILABLE` |

The model loads lazily on first use — seconds on a cold process, milliseconds
after — so the API allows a 60s timeout for this call.

---

## Planned endpoints

Not implemented — listed so the URL surface is predictable.

| Area | Endpoints | Milestone |
| --- | --- | --- |
| Problems | `PATCH /problems/:id`, `DELETE /problems/:id` | Editing |
| Search | `GET /problems/search` (full-text, then semantic) | Prompt 25 |
| Suggestions | `GET /problems/:id/suggestions`, `POST /problems/:id/suggestions` | Later milestone |
| Moderation | `POST /comments/:id/report`, a review queue | Later milestone |
| Notification delivery | Email, push and realtime channels; per-type preferences | Later milestone |
| Organisations | `GET /organizations` (directory), `POST /organizations` (onboarding), `POST /organizations/:id/verify`, leaving an organisation, invitation emails | Later milestones |
| Jurisdiction management | Setting an office's boundary, cities or postal codes | Later milestone |
