# Deployment Guide (Prompt 30)

How to deploy Samadhaan, using the architecture already in the repository.
**Nothing has been deployed to any real account.** The files below have been
prepared; the parts verified locally are marked, and so are the parts that
weren't.

## Topology

```
            Internet (HTTPS only)
                    │
       ┌────────────▼─────────────┐   TLS termination: Caddy (compose) or
       │ Reverse proxy / LB        │   the platform's load balancer
       └────────────┬─────────────┘
                    │ :3100
       ┌────────────▼─────────────┐   Next.js standalone server. The browser
       │ web (Next.js)             │   calls /api on the same origin; web proxies
       └────────────┬─────────────┘   to the API (API_INTERNAL_URL).
        private net │ :4000
       ┌────────────▼─────────────┐   NestJS: all business rules, auth,
       │ api (NestJS)              │   jurisdiction, storage, background sweeps.
       └──┬────────┬────────┬─────┘
          │        │        │ :8001  x-internal-token + x-deadline-ms
          │        │   ┌────▼──────────────┐  FastAPI: embeddings (local model),
          │        │   │ ai (FastAPI)       │  LLM calls (Anthropic), PDF
          │        │   └────────┬──────────┘  extraction, registry models
          │        │            │ HTTPS → api.anthropic.com (if configured)
   ┌──────▼───┐ ┌──▼──────┐ ┌──────────────────┐
   │PostgreSQL│ │ Redis   │ │ S3-compatible     │  private bucket, read only
   │16 PostGIS│ │ 7+      │ │ object storage    │  through the API
   │+pgvector │ └─────────┘ └──────────────────┘
   └──────────┘
```

| Service | Responsibility | Exposure |
| --- | --- | --- |
| **web** | UI, server rendering, `/api` proxy | Public, via TLS proxy |
| **api** | All business logic and authorisation; the only service that touches PostgreSQL, Redis and storage | Private (reached through web). `/api/v1/metrics` only for the scraper with a token |
| **ai** | Embeddings, LLM calls, PDF extraction, registry-model inference | Private. Requires `x-internal-token` from the API |
| **PostgreSQL** | System of record, full-text search, PostGIS, pgvector | Private |
| **Redis** | Caches, rate limits, locks, upload-claim records | Private; password or TLS |
| **Object storage** | Photos, attachments, evidence, knowledge documents | Private bucket; the API reads and serves files |

External dependencies:
- Anthropic API (optional; features degrade without it);
- a geocoder (optional, `GEOCODING_PROVIDER`);
- map tiles (`NEXT_PUBLIC_MAP_STYLE_URL`, public);
- Hugging Face, at image build time only, for the embedding model.

## Required versions

| Component | Version | Why |
| --- | --- | --- |
| Node.js | 22 (`.nvmrc`) | API and web |
| Python | 3.12 in the image (3.11+ supported) | AI service |
| PostgreSQL | 16 (compose image; 17 used in local dev) | — |
| PostGIS | 3.x | `geography`, `ST_DWithin`, GiST |
| pgvector | **≥ 0.8** | HNSW plus `hnsw.iterative_scan` (used by search and RAG) |
| pg_trgm | any | trigram indexes |
| Redis | **≥ 7.0** | `EXPIRE … NX` (rate limiter) |

**Check your managed database before choosing it.** It must offer PostGIS,
pgvector ≥ 0.8 and pg_trgm, and enough `max_connections` for
`replicas × DATABASE_POOL_MAX` plus headroom. Not every provider has
pgvector 0.8; confirm with
`SELECT extversion FROM pg_extension WHERE extname='vector'` after
`CREATE EXTENSION vector`.

## Hosting options

The repository builds three containers, so any container platform works: a
VM with Docker Compose, a managed container service, or Kubernetes if you
already run one. Constraints that rule options in or out:

- **The API runs background sweeps in-process** (timers). It needs a
  long-running process, not request-scoped serverless functions. Sweeps
  coordinate across replicas with Redis locks.
- **The AI service needs about 1–2 GB of RAM** (PyTorch and the embedding
  model) and CPU for embeddings. Scale it with replicas, one worker per
  container.
- **The web app** can run on its own container (`web.Dockerfile`, standalone
  output). It can also run on a managed Next.js host, if that host can reach
  the API over a private network and you set `API_INTERNAL_URL` at build time.
- **Local-disk storage** (`STORAGE_PROVIDER=local`) works only with a single
  API instance and a persistent, backed-up volume, and must be acknowledged
  (`STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true`). Use S3-compatible storage for
  anything else.

## Artifacts

| File | Purpose | Verified |
| --- | --- | --- |
| `infrastructure/docker/api.Dockerfile` | API runtime image (non-root, production dependencies, health check), plus the `migrate` target | **Not built locally** (Docker unavailable here). The CI job `docker-images` builds it. The same `dist/` started under production configuration locally: liveness 200, readiness ok, metrics guarded, CSRF enforced. |
| `infrastructure/docker/web.Dockerfile` | Next.js standalone image | **Not built locally.** The standalone build itself was run and served locally: `/` and `/login` 200, `/api` proxy 200, CSP present. |
| `infrastructure/docker/ai.Dockerfile` | AI service (CPU torch, model preloaded, non-root) | **Not built locally.** CI `docker-images`. |
| `infrastructure/docker/postgres.Dockerfile` | PostGIS 16 + pgvector (existing) | Used by CI |
| `docker-compose.prod.yml` + `infrastructure/caddy/Caddyfile` + `.env.production.example` | Production-like single-host stack with HTTPS | **Not run locally.** CI validates `docker compose config`. |
| `.dockerignore`, `services/ai/.dockerignore` | Keep `.env`, VCS, caches, data and artifacts out of images | CI checks images contain no `.env` and don't run as root |

## Build

```bash
# from the repository root
docker build -f infrastructure/docker/api.Dockerfile -t samadhaan/api:<version> .
docker build -f infrastructure/docker/api.Dockerfile --target migrate -t samadhaan/api-migrate:<version> .
docker build -f infrastructure/docker/web.Dockerfile \
  --build-arg API_INTERNAL_URL=http://<api-internal-host>:4000 \
  -t samadhaan/web:<version>-<environment> .
docker build -f infrastructure/docker/ai.Dockerfile -t samadhaan/ai:<version> services/ai
```

The web image is **per environment**. Next.js fixes rewrites and the CSP at
build time, so `API_INTERNAL_URL` and every `NEXT_PUBLIC_*` value are build
arguments. Keep `NEXT_PUBLIC_API_URL` empty in production, so the browser uses
the same-origin `/api` proxy. Never pass a secret as a build argument.

## Deploy (order matters)

1. **Provision:**
   - PostgreSQL with the extensions (`CREATE EXTENSION postgis; CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;`; migrations also create them if permitted);
   - Redis with a password or TLS;
   - a private bucket;
   - secrets (`PRODUCTION_CONFIGURATION.md`).
2. **Back up** the database, if it already holds data (`RECOVERY_RUNBOOK.md`).
3. **Migrate**: run the `migrate` image once with `DATABASE_URL`:
   `prisma migrate deploy`, then `post-migrate.sql`. The runtime image never
   migrates on start. Prompt 27's migrations rewrite `problems` and
   `knowledge_chunks` under exclusive locks, so schedule them.
4. **Start the AI service**, and wait for `GET /health/live`.
5. **Start the API**; it refuses to boot with an unsafe production
   configuration. Wait for `GET /api/v1/health` to return 200.
6. **Start the web app**, then the proxy.
7. **Run the staging smoke test** (`STAGING_SMOKE_TESTS.md`).

Never run `npm run db:seed` against staging or production. The seed refuses
`NODE_ENV=production` and requires `ALLOW_DEV_SEED=true`, which production
configuration rejects.

## Production-like local stack

```bash
cp .env.production.example .env.production   # fill in every value
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
# https://localhost (Caddy internal CA; trust it or accept the warning)
```

## Rollback

Redeploy the previous image tags. The schema is forward-only. If the new
migration is incompatible with the previous application version, restore the
pre-deploy backup (`RECOVERY_RUNBOOK.md`). Registry models roll back
separately (`MODEL_LIFECYCLE.md`).
