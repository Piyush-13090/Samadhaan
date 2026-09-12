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

## AI service endpoints (internal)

`services/ai` is **not public**. The NestJS API is its only client. Documented
here for operators.

Base URL: `http://localhost:8001`

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Readiness report, consumed by the API's health module |
| `GET /health/live` | Liveness |
| `GET /docs` | OpenAPI UI (disabled when `NODE_ENV=production`) |

Health endpoints are intentionally unauthenticated so orchestrators can probe
them. Capability endpoints, once they exist, require the `x-internal-token`
shared secret (enforced whenever `AI_INTERNAL_TOKEN` is set).

---

## Planned endpoints

Not implemented — listed so the URL surface is predictable.

| Area | Endpoints | Milestone |
| --- | --- | --- |
| Problems | `POST /problems`, `GET /problems`, `GET /problems/:id`, `PATCH /problems/:id/status` | Problem reporting |
| Media | `POST /problems/:id/media` | Problem reporting |
| Support | `POST /problems/:id/support`, `DELETE /problems/:id/support` | Community |
| Comments | `GET /problems/:id/comments`, `POST /problems/:id/comments` | Community |
| Suggestions | `GET /problems/:id/suggestions`, `POST /problems/:id/suggestions` | Community |
| Organisations | `GET /organizations`, `POST /organizations`, `POST /organizations/:id/verify` | Organisations |
| Allocation | `POST /problems/:id/allocate` | Government |
| Resolution | `GET /resolution-rooms/:id`, `POST /resolution-rooms/:id/updates` | Resolution |
| Impact | `GET /leaderboard`, `GET /users/:id/impact` | Impact |
