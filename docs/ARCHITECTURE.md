# Architecture

> **Status:** Foundation milestone. Everything described as *implemented* below
> runs and is covered by tests. Everything else is marked planned.

## Shape

```
                    Browser
                       │
                       │ HTTPS
                       ▼
        ┌──────────────────────────────┐
        │   apps/web — Next.js         │   React 19, App Router, Tailwind v4
        │   Server Components + RSC    │
        └──────────────┬───────────────┘
                       │ HTTP  (/api/v1/*)
                       ▼
        ┌──────────────────────────────┐
        │   apps/api — NestJS          │   Modular monolith. The only
        │   The application boundary   │   component that writes to the
        └───┬──────────┬───────────┬───┘   database or calls the AI service.
            │          │           │
     Prisma │          │ ioredis   │ HTTP (internal)
            ▼          ▼           ▼
    ┌────────────┐ ┌───────┐ ┌──────────────────────┐
    │ PostgreSQL │ │ Redis │ │ services/ai — FastAPI│
    │  PostGIS   │ │       │ │ models & providers   │
    │  pgvector  │ │       │ └──────────┬───────────┘
    └────────────┘ └───────┘            │ HTTPS (planned)
                                        ▼
                                 LLM / embedding providers
```

## The one rule

**The browser talks to the NestJS API and to nothing else.**

The frontend never calls the Python AI service, and never reaches PostgreSQL or
Redis. Every request enters through NestJS.

This is what makes authentication, authorisation, rate limiting, auditing, input
validation and — importantly — **AI spend control** enforceable in one place. If
the browser could call the AI service directly, each of those would have to be
solved twice, and the second implementation would be the one that gets it wrong.

Enforcement is structural, not a convention:

- `apps/web/src/lib/api-client.ts` is the only HTTP client in the frontend, and
  its base URL is the NestJS API.
- `apps/api/src/ai/ai.client.ts` is the only code in the repository that knows
  the AI service's URL.
- The AI service accepts an `x-internal-token` shared secret. When
  `AI_INTERNAL_TOKEN` is set, requests without it are rejected — so in a
  deployed environment only the API can reach it.
- In production the AI service is not exposed publicly and its CORS allow-list
  is empty.

## Why three services and not one

### Why the AI service is separate

The obvious alternative is to run inference inside the NestJS process, or to
call provider APIs from Node. Both were rejected:

1. **The ML ecosystem is Python.** PyTorch, `transformers`,
   `sentence-transformers`, CLIP, YOLO and the RAG tooling are Python-first.
   Node bindings are second-class and lag.
2. **The resource profiles are incompatible.** The API is I/O-bound, holds
   database connections, and should scale on request concurrency. Inference is
   CPU/GPU-bound with large resident models. Sharing a process means one API
   container per copy of a model.
3. **Latency is different by orders of magnitude.** A CRUD request is
   milliseconds; multimodal analysis is seconds. Isolating them keeps a slow
   model from exhausting the request pool that serves page loads.
4. **They change at different rates.** Swapping an embedding model should not
   redeploy the application API.

### Why the application is a monolith, not microservices

Problems, comments, suggestions, organisations and resolution rooms are densely
related — nearly every meaningful query joins across them. Splitting them into
services this early would replace SQL joins with network calls and transactions
with distributed-consistency problems, for no benefit at this scale.

So: **a modular monolith**. One deployable, with enforced internal boundaries.
Each module owns its domain and exposes a service; modules depend on injected
services, never on each other's tables. If a module ever genuinely needs its own
deployment, its callers already talk to it through an interface.

The AI service is the one split that pays for itself immediately, for the
reasons above.


## Authentication, authorisation and RBAC

Three distinct things, often conflated:

| | Question | Where |
| --- | --- | --- |
| **Authentication** | Who is making this request? | `JwtAuthGuard` |
| **Authorisation** | May *this* principal do *this*? | `RolesGuard` |
| **RBAC** | The model used to answer it: permissions attach to roles, roles to users | `UserRole` enum |

RBAC is one authorisation model among several — the alternative being per-user
permission grants. It was chosen because Samadhaan's permissions genuinely
cluster by role: every government reviewer can do the same things, and none of
them needs an individually curated permission set. When ownership rules arrive
(a citizen may edit *their own* problem), those are checked in the service layer
against the record, because they depend on data rather than on role alone.

### The request path

```
Browser
  │  cookies: sam_access (JWT, 15m) · sam_refresh (opaque, 30d) — both httpOnly
  ▼
Next.js  ──── proxies /api/* ────┐   Same-origin, so the cookies are first-party
  │ requireUser() / requireRole()│   and SameSite=Lax defeats CSRF.
  ▼                              ▼
Server Components            NestJS API
  (authoritative page-level      │
   check via /auth/me)           ▼
                          RateLimitGuard      throttle before expensive work
                                 │
                                 ▼
                          JwtAuthGuard        verify JWT + confirm session row
                                 │
                                 ▼
                          RolesGuard          check @Roles against the principal
                                 │
                                 ▼
                          Controller → Service → Prisma
```

All three guards are registered **globally**. The consequence is that every
endpoint added from now on is authenticated by default, and exposing one
requires writing `@Public()`. The opposite arrangement — opting routes into
protection — fails silently the first time somebody forgets a decorator, and
that failure is an open endpoint.

### Four layers, one authority

| Layer | Checks | Authoritative? |
| --- | --- | --- |
| `proxy.ts` | Session cookie is *present* | No — UX only |
| Server Components | Calls `/auth/me`; real verification | For page rendering |
| `JwtAuthGuard` | Signature, expiry, session row, account status | **Yes** |
| `RolesGuard` | Role against `@Roles` | **Yes** |

Only the guards decide anything that matters. `proxy.ts` runs on every request
including prefetches, so it deliberately does no cryptography and no database
work — it exists to save a signed-out visitor a wasted render. A forged cookie
sails past it and is rejected by the guards.

### Why two token types

Access tokens are signed JWTs: stateless, verified without a database round
trip, and therefore cheap on every request. The cost of that is they cannot be
recalled, so they live 15 minutes.

Refresh tokens are the opposite: opaque random values with no claims, meaningful
only as a lookup key into `sessions`. That is what makes logout real — deleting
the row ends the session immediately. Only a SHA-256 digest is stored, so a
database leak yields nothing replayable.

Using JWTs for refresh as well is the common mistake: it would make refresh
unrevocable too, and "sign out" would become a lie.

Refresh is **single-use**. Presenting a token twice means it is either a replay
or a race with a stolen copy; since those are indistinguishable, every session
for that user is revoked.

### Passwords

Argon2id, with OWASP's recommended parameters (19 MiB, 2 iterations). The
parameters are encoded in the hash, so raising them later does not invalidate
existing hashes — `needsRehash` flags old ones and they are upgraded silently at
the next sign-in, the only moment the plaintext is available.

### Preventing privilege escalation

Structural, not procedural:

- `RegisterDto` has no `role` field, and validation runs with
  `forbidNonWhitelisted` — so `{"role": "ADMIN"}` is rejected, not ignored.
- `AuthService.register` hard-codes `CITIZEN`. There is no code path from a
  public request to a privileged account.
- `UpdateProfileDto` has no `role` or `status`, and `updateProfile` accepts only
  `ProfileUpdate`, so the repository could not write them even if a DTO changed.
- The user id always comes from the verified token, never from the request.

## Components

### `apps/web` — Next.js (implemented)

React 19 with the App Router. Server Components fetch through the API client on
the server, so the API base URL can differ between browser and server (a Docker
service name internally, a public hostname externally).

- `src/app/` — routes, layouts, error boundaries, loading states
- `src/components/ui/` — design-system primitives (card, badge, alert, skeleton)
- `src/components/layout/` — header, footer, page container
- `src/lib/` — API client, error types, validated environment access
- `src/services/` — one module per domain, owning that domain's API paths
- `src/hooks/`, `src/types/` — shared client hooks and types

Error handling has three layers: `error.tsx` per route segment,
`global-error.tsx` for failures in the root layout, and `not-found.tsx`.

Design direction is **light only** — warm white canvas, white cards, charcoal
text, indigo and teal accents. Tokens live in `src/app/globals.css` under
Tailwind v4's `@theme`. There is deliberately no dark palette.

### `apps/api` — NestJS (implemented)

```
src/
├── main.ts, bootstrap.ts   Composition root and shared app wiring
├── config/                 Zod-validated environment, typed accessor
├── common/                 Response envelope, exception filter, request id
├── database/               PrismaService (global)
├── redis/                  RedisService (global)
├── ai/                     AiService -> AiClient -> FastAPI
├── health/                 Liveness and dependency readiness
├── auth/                   Guards, decorators, token/session/password services
├── users/                  Repository, profile controller, response serializer
└── problems/ organizations/ comments/ suggestions/ notifications/
                            Module boundaries only — implemented in later milestones
```

Cross-cutting decisions:

- **Response envelope.** Every response is `{ success, data, meta }` or
  `{ success, error, meta }`, built in one place
  (`common/api-response.ts`) and applied by a global interceptor and a global
  exception filter. Unmatched routes are caught by a terminal handler so even a
  404 returns the documented shape rather than Express's HTML.
- **Stable error codes.** Clients branch on `error.code`, never on HTTP status
  or message text.
- **Fail-fast configuration.** `config/env.schema.ts` validates and coerces the
  environment once at boot. A missing `DATABASE_URL` stops startup with a
  message naming the variable.
- **Degrade, don't crash.** An unavailable PostgreSQL, Redis or AI service is
  logged and surfaced in `/health`; it never prevents the process from starting.
  An operator needs a running service that reports what is broken.
- **URI versioning.** Routes are `/api/v1/*`. A v2 is a decorator change.
- **Correlation ids.** `x-request-id` is accepted or generated, attached to
  every log line, forwarded to the AI service, and returned in `meta.requestId`.

### `services/ai` — FastAPI (implemented, no AI capabilities yet)

```
app/
├── main.py       App, middleware, error handlers
├── api/          Routers and dependencies
├── core/         Settings, logging, constants, internal-token auth
├── schemas/      Pydantic contracts (mirroring packages/shared)
├── services/     One module per capability
├── models/       Model loading and inference wrappers (empty)
└── utils/
```

Runs independently: `uvicorn app.main:app --reload --port 8001`.

The health report distinguishes *the service is down* from *the service is up
but has no LLM credentials* — the latter is `degraded`, and the API passes that
verdict through rather than flattening it.

No AI capability is implemented. There are no placeholder classifiers and no
random scores: a fabricated result is worse than an absent one, because it looks
like it works. See [`ML_PLAN.md`](./ML_PLAN.md).

### `packages/shared` — shared types (implemented)

Types that must not drift across the service boundary: the response envelope,
the health report, role and status enums, and error codes. Consumed by both
`apps/web` and `apps/api`; the Python schemas mirror them by hand, and the e2e
tests assert the field names match.

### PostgreSQL (implemented)

PostgreSQL 16+ with three extensions, created by both
`infrastructure/database/init.sql` and the Prisma migration:

- **PostGIS** — problem locations, radius search, clustering
- **pgvector** — semantic duplicate detection and RAG retrieval
- **pg_trgm** — fuzzy title matching

Prisma is the ORM. Prisma 7 reads the connection URL from `prisma.config.ts` and
the runtime client connects through the `@prisma/adapter-pg` driver adapter.

### Redis (implemented — connection only)

Connected and health-checked. It will back caching, rate limiting, background
jobs, notification fan-out and AI processing queues. None of those are built
yet; only the connection foundation exists.

`lazyConnect` with a bounded retry strategy and an `error` listener means an
unavailable Redis degrades health rather than taking the process down.

## Request path

A page load of `/status`:

1. Browser requests `/status` from Next.js.
2. The server component calls `fetchSystemHealth()`, which uses the server API
   client (`API_INTERNAL_URL`).
3. NestJS receives `GET /api/v1/health`. `RequestIdMiddleware` assigns a
   correlation id.
4. `HealthService` probes PostgreSQL (`SELECT 1`), Redis (`PING`) and the AI
   service (`GET /health`) **in parallel**, each timed, none able to throw.
5. `AiClient` calls the AI service with the correlation id and a timeout.
6. The report is wrapped in the response envelope by the global interceptor.
7. Next.js renders it. If the API is unreachable, the page renders an explicit
   error state — it does not crash.

## Deployment

Development containerises only stateful infrastructure — PostgreSQL and Redis —
via `docker compose up -d`. The three application services run on the host with
hot reload, which is a materially faster loop than rebuilding containers.

Production images for web, api and ai belong to a later milestone.

## Decisions worth knowing

| Decision | Why |
| --- | --- |
| Modular monolith + separate AI service | Domain is densely joined; ML is Python and has a different resource profile |
| Browser never calls the AI service | One enforceable place for auth, limits, auditing and AI spend |
| Envelope built in one module | The success interceptor, error filter and 404 handler cannot drift |
| Health degrades instead of crashing | A service that reports what is broken beats one that will not start |
| Zod env validation at boot | Misconfiguration fails with a named variable, not a null deref later |
| Light-only design system | Civic reporting is public, daylight, mobile work |
| Cursor pagination in the base DTO | Problem feeds are large and append-heavy; offsets skip and repeat rows |
| No fabricated AI responses | A fake classifier is indistinguishable from a broken real one |
| Tokens in httpOnly cookies | `localStorage` hands any injected script an exfiltratable credential |
| Browser reaches the API same-origin | Makes the cookies first-party, so `SameSite=Lax` stops CSRF |
| JWT access + opaque refresh | Cheap stateless checks, with revocation that actually works |
| Guards registered globally | New endpoints are protected by default; exposure is explicit |
| Role fixed server-side at registration | A request body must never be able to choose its own privileges |
