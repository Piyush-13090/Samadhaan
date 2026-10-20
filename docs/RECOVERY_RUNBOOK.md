# Recovery Runbook (Prompt 29)

What to do when something breaks, and how to restore. Commands assume a
staging or production shell with `DATABASE_URL` set. **Never run restore
commands against a database you haven't identified.** Every destructive step
below names its target explicitly.

**Status:** these procedures were checked step by step on a development
machine (migration replay and idempotency, drift detection). **No restore has
been rehearsed on production-like infrastructure.** That rehearsal is a
release blocker (`PRODUCTION_READINESS.md`).

## What holds state

| Store | Holds | Loss impact |
| --- | --- | --- |
| **PostgreSQL** (PostGIS, pgvector, pg_trgm) | Everything durable: users, sessions, problems, allocations, rooms, projects, evidence, ledger, audit, knowledge, model registry. | Total. Back up. |
| **Storage root** (`STORAGE_LOCAL_ROOT`; local driver only) | Problem photos, room attachments, evidence files, knowledge documents. | Files lost; rows remain and the media routes return 404. Back up with the database. |
| **Model artifacts** (`ML_ARTIFACT_DIR`) | Trained-model JSON. None active today. | Inference falls back (`ARTIFACT_ERROR`). Re-deploy from the release artifact store. |
| **Redis** (append-only file on) | Caches, rate-limit windows, upload-claim records and sweep index, sweep locks, impact-reconcile cursors, recent searches, query-embedding cache. | **Tolerable.** See "Redis loss". |
| **In-process state** | Domain event bus (at-most-once), job queues, circuit breakers, active-model cache. | Lost on restart; see "Background jobs". |

## Backups

```bash
# Database: custom format, compressed, consistent snapshot.
pg_dump --format=custom --no-owner --file=samadhaan-$(date -u +%Y%m%dT%H%MZ).dump "$DATABASE_URL"

# Storage (local driver): copy right after the dump, so few or no rows point
# at files the copy lacks.
tar -czf storage-$(date -u +%Y%m%dT%H%MZ).tar.gz -C "$STORAGE_LOCAL_ROOT" .
```

**Use client tools of the server's major version.** `pg_dump` refuses to dump
a newer server ("aborting because of server version mismatch"). The 2026-10-19
drill hit this: PostgreSQL 16 client tools against a 17 server. On a host with
several versions, put the matching `bin/` first on `PATH`.

Recommended: daily full dumps with point-in-time recovery (WAL archiving) on
a managed PostgreSQL, 30-day retention, storage synced alongside, and backups
encrypted at rest. Backups hold citizens' personal data: same access controls
as production.

## Restore

```bash
# 1. A NEW, empty database (never restore over the live one).
createdb samadhaan_restore
psql -d samadhaan_restore -c 'CREATE EXTENSION postgis; CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;'

# 2. Restore.
pg_restore --no-owner --dbname=samadhaan_restore samadhaan-<stamp>.dump

# 3. Objects Prisma can't express (HNSW, expression and partial indexes) are
#    in the dump; re-applying is safe and idempotent.
psql -d samadhaan_restore -f apps/api/prisma/sql/post-migrate.sql

# 4. Confirm the schema matches the code being deployed.
DATABASE_URL=postgresql://.../samadhaan_restore npx prisma migrate status   # from apps/api

# 5. Storage.
tar -xzf storage-<stamp>.tar.gz -C "$STORAGE_LOCAL_ROOT"

# 6. Point the API at the restored database, start it, and check readiness.
curl -fsS https://<api>/api/v1/health
```

### Drill record

| Date | Where | Result |
| --- | --- | --- |
| 2026-10-19 | **Local only** (development PostgreSQL 17.11, synthetic data, 2.1 MB dump), restored into a new `samadhaan_restore_drill` database and then dropped | **PASS** after the client-version fix above. Dump 1 s, restore 2 s, `pg_restore` exit 0; `post-migrate.sql` idempotent; `prisma migrate status` up to date (22 migrations). Row counts identical for users, problems, audit logs, impact ledger, allocations, rooms, embeddings, knowledge chunks and migrations. Extensions: postgis 3.6.4, vector 0.8.6, pg_trgm 1.6. Append-only triggers present and refusing UPDATE. The API booted against the restored copy: readiness ok, sign-in 200. Storage restore not exercised (local driver, no files at stake). |
| — | **Staging / production-like infrastructure** | **NOT RUN.** Needs the staging database and its managed backups. Time the restore at real data size. |

After a restore, the background sweeps catch up on their own:
- impact reconciliation;
- priority refresh;
- RAG ingestion of PENDING sources;
- verification of PENDING evidence.

## Migrations

- **Forward-only.** Prisma has no down migrations. A bad migration is fixed by
  a new forward migration, or by restoring the pre-deploy backup.
- **Take a backup immediately before `prisma migrate deploy` in production.**
- **Validate first:** `apps/api/scripts/ci/check-migrations.sh` (CI job
  "Migrations + API e2e") replays every migration on a clean database and
  applies `post-migrate.sql` twice to confirm it's idempotent. It then fails
  on any drift from `schema.prisma` and checks that the required extensions
  and indexes exist.
- **Not reversible without a backup:**
  - `20260912144258_core_domain_model` and `20260913120000_embedding_dimension_384`
    (they drop or retype columns);
  - `20261017090000_search_vector` and `20261017091000_knowledge_content_vector`.

  The last two drop expression indexes and rewrite their tables under
  ACCESS EXCLUSIVE locks (about 8 s per 100k problems, measured in Prompt 27),
  so schedule them in a maintenance window.
- **A failed migration** (`P3009`): fix the cause, then
  `npx prisma migrate resolve --rolled-back <name>` (if nothing applied) or
  `--applied <name>` (if it completed manually), and redeploy.

## Redis loss

Restart Redis (the append-only file restores most keys) or start empty.
Losing all of it means:

| Lost | Effect | Action |
| --- | --- | --- |
| Rate-limit windows | Limits reset | None |
| Caches (search, analytics, leaderboard, geocoding, embeddings) | Slower until warm | None |
| Upload-claim records | Uploads in flight must be re-uploaded; the orphan sweep can't see their files | Optional: delete unreferenced `problems/` keys older than a day |
| Sweep locks and reconcile cursors | Next sweep starts from the beginning | None |
| Recent searches | Per-user history lost | None |

While Redis is **down**:
- the API stays up (readiness reports `degraded`);
- rate limiting fails open (documented), so watch the AI-provider spend;
- the idempotent sweeps still run, but the coordinator's paid sweep doesn't.

## AI service or provider outage

- Reports, comments, allocations and tasks keep working. AI is never on their
  critical path.
- Analyses are marked FAILED after bounded retries and can be re-run
  (`reanalyze`).
- Search falls back to keyword results, and knowledge answers return 503.
- After 5 consecutive failures, a group of AI endpoints fails fast for 30 s
  (circuit breaker, log line `AI service circuit "<group>" closed -> open`),
  then one trial call is let through.
- Registry-model inference falls back silently and is recorded in
  `model_inferences`.
- To stop all registry inference: `ML_INFERENCE_ENABLED=false`. Roll back a
  bad model with `POST /api/v1/admin/ml/tasks/:task/rollback`
  (`MODEL_LIFECYCLE.md`).

## PostgreSQL outage

Readiness returns 503 and requests fail. Connection waits are bounded by
`DATABASE_POOL_ACQUIRE_TIMEOUT_MS` (10 s). Nothing is queued in memory for
later: when the database returns, sweeps resume, and clients retry.
Notifications for events that occurred during the outage aren't replayed.

## Background jobs after a crash or deploy

All jobs are in-process timers. Each one, and how it recovers:

| Job | Recovery |
| --- | --- |
| Impact reconciliation (`IMPACT_RECONCILE_MINUTES`) | Re-derives missing ledger awards from database state (idempotency keys) |
| Priority sweep | Recomputes stale or missing assessments |
| Verification sweep | Re-claims PENDING evidence analyses; `recover()` resets stuck PROCESSING |
| RAG ingestion | Resumes PENDING and PROCESSING sources (lease-based) |
| Upload sweep | Deletes unreferenced uploads past their claim window |
| Coordinator | Next schedule re-analyses stale projects |
| Model-monitoring prune | Hourly |

**Not recovered:** domain events published but not yet delivered when the
process died. These are notifications, plus duplicate-identified impact
awards, which reconciliation doesn't cover.

## Incident checklist

1. Check `GET /api/v1/health` and `/health/live` on the API, and `/health` on
   the AI service.
2. Find the request id from the client (it's in every error response) and grep
   the logs for it across both services.
3. For a security incident, follow `INCIDENT_RESPONSE.md`.
4. Before any data repair: take a backup, write the SQL in a transaction, and
   have it reviewed. Never edit `audit_logs` or `impact_point_transactions`;
   both are append-only by trigger.
