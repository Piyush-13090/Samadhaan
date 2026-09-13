# Samadhaan

AI-powered civic problem intelligence and resolution platform.

A citizen photographs a real-world problem. Samadhaan turns it into structured,
categorised, deduplicated work; connects it to the organisations able to act;
and tracks it through to a verified resolution.

> **Status: foundation milestone.** The architecture, infrastructure and
> development workflow are in place and tested. No product feature is
> implemented yet — see [Implementation status](#implementation-status).

---

## Architecture

```
Browser  ──HTTP──▶  Next.js  ──HTTP──▶  NestJS API  ──┬──▶  PostgreSQL (PostGIS, pgvector)
                                                       ├──▶  Redis
                                                       └──▶  FastAPI AI service ──▶ model providers
```

**The browser talks to the NestJS API and to nothing else.** The frontend never
calls the Python AI service directly. NestJS is the single application boundary,
which is what makes authentication, rate limiting, auditing and AI spend control
enforceable in one place.

The application is a **modular monolith** — the domain is densely joined and
splitting it early would trade SQL joins for network calls. The AI service is
separate because the ML ecosystem is Python and inference has a completely
different resource and latency profile.

Full reasoning: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| API | NestJS 12, TypeScript (ESM), Prisma 7 |
| AI service | Python 3.11+, FastAPI, Pydantic v2, structlog |
| Database | PostgreSQL 16+ with PostGIS, pgvector, pg_trgm |
| Cache / queues | Redis 7 |
| Infrastructure | Docker Compose |
| Tooling | npm workspaces, Vitest, pytest, oxlint, ESLint, Ruff, Prettier |

## Repository structure

```
samadhaan/
├── apps/
│   ├── web/                  Next.js frontend
│   │   └── src/
│   │       ├── app/          Routes, layouts, error boundaries, loading states
│   │       ├── components/   ui/ primitives, layout/ chrome
│   │       ├── lib/          API client, error types, env access
│   │       ├── services/     One module per domain
│   │       ├── hooks/  types/
│   └── api/                  NestJS API
│       ├── prisma/           Schema and migrations
│       └── src/
│           ├── config/       Zod-validated environment
│           ├── common/       Response envelope, filters, interceptors
│           ├── database/     Prisma service
│           ├── redis/        Redis service
│           ├── ai/           AiService -> AiClient -> FastAPI
│           ├── health/       Liveness and dependency readiness
│           ├── users/        User repository
│           └── auth/ problems/ organizations/ comments/ suggestions/ notifications/
│                          Module boundaries — implemented in later milestones
├── services/ai/              FastAPI AI service
│   └── app/                  main.py, api/, core/, schemas/, services/, models/, utils/
├── packages/shared/          Types shared by web and api
├── infrastructure/
│   ├── docker/               PostgreSQL image with PostGIS + pgvector
│   └── database/             init.sql
├── docs/                     PRODUCT, ARCHITECTURE, DATABASE, API, ML_PLAN
├── docker-compose.yml
└── .env.example
```

---

## Setup

### Prerequisites

- **Node.js 20.11+** (22 recommended — see `.nvmrc`)
- **Python 3.11+**
- **Docker** with Compose v2 — or PostgreSQL 17 + Redis natively (see below)

### 1. Install dependencies

```bash
git clone <repository-url> samadhaan
cd samadhaan
npm install
```

### 2. Configure the environment

```bash
cp .env.example .env
```

One `.env` at the repository root drives all three services. Defaults work for
local development; nothing needs editing to start.

### 3. Start infrastructure

```bash
docker compose up -d
```

Starts PostgreSQL (with PostGIS, pgvector and pg_trgm) and Redis. The PostgreSQL
image is built from `infrastructure/docker/postgres.Dockerfile` on first run.

Verify:

```bash
docker compose ps
```

<details>
<summary><strong>No Docker? Run PostgreSQL and Redis natively (macOS / Homebrew)</strong></summary>

Docker Compose is the supported path. If Docker is unavailable, the same stack
runs natively — the extensions require **PostgreSQL 17**, since the Homebrew
`postgis` and `pgvector` formulae do not build against 16:

```bash
brew install postgresql@17 postgis pgvector redis
brew services start postgresql@17
brew services start redis

# Create the role and database that .env expects
/opt/homebrew/opt/postgresql@17/bin/psql -d postgres \
  -c "CREATE ROLE samadhaan LOGIN PASSWORD 'samadhaan_dev_password' CREATEDB SUPERUSER;"
/opt/homebrew/opt/postgresql@17/bin/createdb -O samadhaan samadhaan
```

`npm run db:migrate` then creates the extensions and the schema — the migration
carries the same `CREATE EXTENSION` statements as `init.sql`, so no extra step
is needed.

Verify:

```bash
/opt/homebrew/opt/postgresql@17/bin/psql -U samadhaan -d samadhaan \
  -c "SELECT extname, extversion FROM pg_extension ORDER BY extname;"
redis-cli ping
```

Skip `npm run dev:infra`; use `npm run dev:api`, `dev:web` and `dev:ai`
individually, or run `docker compose up -d`'s replacement as above once.
</details>

### 4. Set up the database

```bash
npm run db:generate     # generate the Prisma client
npm run db:migrate      # apply migrations
npm run db:seed         # create development accounts (see below)
```

#### Development accounts

`npm run db:seed` creates one account per role so every workspace can be tried
immediately. They all share the password **`DevPassword123!`**.

| Email | Role | Lands on |
| --- | --- | --- |
| `citizen@samadhaan.dev` | Citizen | `/dashboard` |
| `ngo@samadhaan.dev` | NGO | `/organization` |
| `university@samadhaan.dev` | University | `/organization` |
| `industry@samadhaan.dev` | Industry | `/organization` |
| `government@samadhaan.dev` | Government | `/government` |
| `admin@samadhaan.dev` | Admin | `/admin` |

> ⚠️ **Development only.** These are published, known credentials. The seed
> refuses to run unless `NODE_ENV` is not `production` **and**
> `ALLOW_DEV_SEED=true` — two independent guards, so one misconfigured variable
> is not enough to create them somewhere real.

### 5. Set up the AI service

```bash
cd services/ai
python3 -m venv .venv
./.venv/bin/pip install -r requirements-dev.txt
cd ../..
```

`npm run dev:ai` does this automatically on first run.

### 6. Run everything

```bash
npm run dev
```

Starts the API, the frontend and the AI service together.

| Service | URL |
| --- | --- |
| Frontend | http://localhost:3100 |
| API | http://localhost:4000/api/v1 |
| AI service | http://localhost:8001 |
| AI service docs | http://localhost:8001/docs |

Open **http://localhost:3100/status** — it shows live health for PostgreSQL,
Redis and the AI service, fetched through the API. Every value is a real probe.

> **Ports.** The frontend uses 3100 and the AI service 8001, rather than the
> conventional 3000 and 8000, to avoid colliding with other local dev servers.
> Change `WEB_PORT` / `AI_PORT` in `.env` if you prefer (keep `CORS_ORIGINS` and
> `AI_SERVICE_URL` in sync).

---

## Environment variables

Full documentation with comments: [`.env.example`](./.env.example).

**Required**

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `AI_SERVICE_URL` | AI service base URL (server-side only) |
| `JWT_ACCESS_SECRET` | Signs access tokens. Minimum 32 chars; `openssl rand -base64 48` |

**Commonly adjusted**

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_PORT` | `4000` | API port |
| `WEB_PORT` | `3100` | Frontend port |
| `AI_PORT` | `8001` | AI service port |
| `CORS_ORIGINS` | `http://localhost:3100` | Comma-separated allowed origins |
| `LOG_LEVEL` | `debug` | `fatal`…`trace`, `silent` |
| `AI_SERVICE_TIMEOUT_MS` | `15000` | Per-call AI timeout |
| `API_INTERNAL_URL` | `http://localhost:4000` | API URL for Next.js server components |
| `AI_INTERNAL_TOKEN` | *(empty)* | Shared secret; when set, the AI service requires it |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access-token lifetime (stateless, so keep it short) |
| `REFRESH_TTL_SECONDS` | `2592000` | Refresh-token lifetime (revocable, so it can be long) |
| `AUTH_COOKIE_SECURE` | `false` | **Must be `true` in production** (requires HTTPS) |
| `AUTH_RATE_LIMIT_MAX` | `10` | Sign-in attempts per window, per IP + email |
| `ALLOW_DEV_SEED` | `false` | Must be `true` for `npm run db:seed` |
| `STORAGE_PROVIDER` | `local` | Image storage driver (`local` writes to `STORAGE_LOCAL_ROOT`) |
| `UPLOAD_MAX_IMAGE_BYTES` | `8388608` | Per-image byte cap |

**AI analysis** — read by `services/ai` only. Provider credentials never leave
that process; Next.js and the browser never see them.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | `development` | `anthropic` for real analysis, `development` for the offline stub |
| `LLM_API_KEY` | *(empty)* | Required by `anthropic`. Without it the service returns `PROVIDER_UNAVAILABLE` rather than fabricating a result |
| `LLM_MODEL` | `claude-opus-5` | Vision model id |
| `LLM_TIMEOUT_SECONDS` | `60` | Per-call provider timeout |

> The `development` provider is a keyword-matching stub, not a model. It labels
> itself in the response and the UI warns whenever it produced an analysis, and
> the provider factory **refuses to build it when `NODE_ENV=production`**.

**Reserved for later milestones** — declared in `.env.example`, not read by any
code yet: `EMBEDDING_*`, `SMTP_URL`, `GEOCODING_API_KEY`.

The API validates its environment at boot (`apps/api/src/config/env.schema.ts`).
A missing or malformed variable stops startup with a message naming it.

> `.env` is git-ignored. Never commit real secrets.

---

## Development commands

### Root

| Command | Does |
| --- | --- |
| `npm run dev` | Infrastructure, then API + web + AI together |
| `npm run dev:web` / `dev:api` / `dev:ai` | One service |
| `npm run build` | Build shared, api and web |
| `npm run lint` | Lint all three services |
| `npm run typecheck` | Typecheck every workspace |
| `npm test` | Unit tests (API + AI) |
| `npm run test:e2e` | End-to-end tests (needs infrastructure running) |
| `npm run verify` | build + lint + typecheck + test |
| `npm run format` | Prettier |

### Infrastructure

| Command | Does |
| --- | --- |
| `docker compose up -d` | Start PostgreSQL and Redis |
| `docker compose ps` | Status |
| `docker compose logs -f` | Follow logs |
| `docker compose down` | Stop (data kept in named volumes) |
| `docker compose down -v` | Stop and **delete all data** |

### Database

| Command | Does |
| --- | --- |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:studio` | Browse data |

### AI service

```bash
npm run dev:ai                          # hot reload (creates .venv on first run)
services/ai/.venv/bin/pytest services/ai
services/ai/.venv/bin/ruff check services/ai
```

The AI service runs independently of the rest of the stack.

---

## Testing

```bash
npm run verify          # everything
npm test                # unit tests
npm run test:e2e        # e2e — requires docker compose up -d
```

The e2e suite boots the real NestJS application with the same wiring as
production and asserts that it connects to PostgreSQL and Redis and reaches the
AI service over HTTP. It is the check that the foundation actually holds
together.

---

## Implementation status

### Implemented

- **Citizen problem reporting** — a three-step flow (problem → location →
  review) with multi-image upload, browser geolocation with manual fallback,
  and atomic submission returning a `SAM-` reference
- **Object storage abstraction** — provider-agnostic `StorageService` with a
  local development driver; no binary data in PostgreSQL
- **Authentication** — registration, sign-in, sign-out, refresh; Argon2id
  password hashing; JWT access tokens plus revocable database-backed refresh
  sessions, both in `httpOnly` cookies
- **RBAC** — six roles, enforced by globally registered NestJS guards with
  `@Roles()` / `@Public()` / `@CurrentUser()` decorators
- **Role-aware routing** — citizen, organisation, government and admin
  workspaces with role-specific navigation
- Profile page and `PATCH /users/me`, with role and status not editable
- Redis-backed rate limiting on the authentication endpoints
- Development seed with one account per role, guarded against production
- Monorepo with npm workspaces; shared types package
- Next.js frontend: layout, error boundaries, loading states, responsive
  behaviour, light design system, validated env, API client
- NestJS API: config validation, structured response envelope, global exception
  handling, request validation, correlation ids, pino logging, URI versioning
- Health: `GET /api/v1/health` probing PostgreSQL, Redis and the AI service, and
  `GET /api/v1/health/live`
- FastAPI AI service: config, structured logging, internal-token auth, error
  handlers, health endpoints — independently runnable
- PostgreSQL with PostGIS, pgvector and pg_trgm; Prisma 7 with an initial
  migration and a `User` model with roles
- Redis connection and health probe
- Docker Compose for PostgreSQL and Redis
- Tests: 96 API unit, 158 API e2e, 71 web unit, 7 AI service

### Not implemented

Comments, voting, suggestions, AI classification, duplicate detection,
organisation workflows, government dashboards, resolution rooms, evidence
verification, leaderboard, RAG, custom ML models.

**AI analysis has not been built.** A submitted report is `SUBMITTED` and
unassessed; the confirmation screen says so rather than implying otherwise.

Organisation and government accounts can be seeded but cannot yet self-register —
their verification and invitation flows arrive with the organisations milestone.

**No fake AI logic and no mock data exist in this repository.** The status page
shows real probes against real services.

---

## Roadmap

| Milestone | Delivers |
| --- | --- |
| Problem reporting | Submission, media upload, geotagging, feeds, status transitions |
| AI understanding | Multimodal analysis, classification, severity estimation |
| Duplicate detection | Embeddings, geographic + semantic + visual cascade |
| Community | Support, comments, suggestions, endorsement |
| Organisations | Profiles, verification, discovery, expressions of interest |
| Government | Triage queue, priority prediction, allocation |
| Resolution rooms | Collaboration workspace, AI Project Coordinator, progress extraction |
| Verification | Completion evidence, AI-assisted verification, closure |
| Impact | Impact Points, leaderboard, analytics |

Details: [`docs/PRODUCT.md`](./docs/PRODUCT.md) and [`docs/ML_PLAN.md`](./docs/ML_PLAN.md).

---

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/PRODUCT.md`](./docs/PRODUCT.md) | What Samadhaan is, users, roles, workflow, vision |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Service topology and the reasoning behind it |
| [`docs/DATABASE.md`](./docs/DATABASE.md) | Entities implemented now vs planned, index plan |
| [`docs/API.md`](./docs/API.md) | Conventions and implemented endpoints |
| [`docs/ML_PLAN.md`](./docs/ML_PLAN.md) | The twelve planned AI systems and their model stack |

## Troubleshooting

**`Invalid environment configuration`** — `.env` is missing or incomplete.
`cp .env.example .env`. The message names the offending variable.

**`database: down` on the status page** — infrastructure is not running.
`docker compose up -d`, then `docker compose ps`.

**`aiService: down`** — the AI service is not running. `npm run dev:ai`.
The API stays healthy without it; only AI features degrade.

**`aiService: degraded`** — expected. The service is running but has no LLM or
embedding credentials configured, which no milestone has needed yet.

**Port already in use** — change `WEB_PORT`, `API_PORT` or `AI_PORT` in `.env`
and keep `CORS_ORIGINS` and `AI_SERVICE_URL` in sync.

**Prisma reports schema drift** — the extension lists in
`apps/api/prisma/schema.prisma` and `infrastructure/database/init.sql` must stay
identical.
# Samadhaan
