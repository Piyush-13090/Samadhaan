# Database

PostgreSQL 16+ with PostGIS, pgvector and pg_trgm. Prisma is the ORM.

> This document separates **what exists** from **what is planned**. The planned
> section is a design sketch, not a description of running code.

---

## Implemented now

### Extensions

| Extension | Purpose | Status |
| --- | --- | --- |
| `postgis` | Problem locations, radius search, clustering | Created |
| `vector` | Semantic duplicate detection, RAG retrieval | Created |
| `pg_trgm` | Fuzzy text matching on problem titles | Created |

They are created in two places, deliberately:

- `infrastructure/database/init.sql` runs once when the Docker data directory is
  first initialised, so a fresh `docker compose up` has a usable database before
  any migration runs.
- The Prisma datasource declares them, so `prisma migrate` emits
  `CREATE EXTENSION IF NOT EXISTS` and keeps them in the migration history for
  environments not provisioned by that script.

**The two lists must stay identical.** If they diverge, `prisma migrate` reports
schema drift against a Docker-provisioned database.

### `User`

Table `users`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Random UUID, not a sequence — see below |
| `email` | `text` unique | Stored lower-cased |
| `passwordHash` | `text?` | Argon2id. Null for future OAuth accounts |
| `fullName` | `text` | |
| `displayName` | `text?` unique | Public handle for mentions and leaderboard |
| `phone` | `text?` unique | |
| `avatarUrl` | `text?` | |
| `role` | `UserRole` | Default `CITIZEN` |
| `status` | `UserStatus` | Default `PENDING_VERIFICATION` |
| `emailVerifiedAt` | `timestamp?` | |
| `lastLoginAt` | `timestamp?` | |
| `createdAt` | `timestamp` | |
| `updatedAt` | `timestamp` | |
| `deletedAt` | `timestamp?` | Soft delete |

**Enums**

```prisma
enum UserRole   { CITIZEN NGO UNIVERSITY INDUSTRY GOVERNMENT ADMIN }
enum UserStatus { PENDING_VERIFICATION ACTIVE SUSPENDED }
```

**Indexes**

- unique on `email`, `displayName`, `phone`
- `(role, status)` — serves "active organisations of type X", the query
  organisation discovery will run constantly
- `deletedAt` — every read filters on it
- `createdAt` — ordering for admin listings

### Decisions on this table

**UUID primary keys, not auto-increment.** Problem ids appear in public URLs; a
sequential id leaks total volume and lets anyone enumerate every report. UUIDs
also let a client generate an id offline, which matters for a mobile reporting
flow that must work without connectivity.

**Soft delete via `deletedAt`.** A deleted account's problems, comments and
resolution history must survive — this is an accountability record. Hard
deletion would either cascade away civic history or leave dangling references.
`UsersRepository` applies `deletedAt: null` in one place so no caller can
accidentally resurrect a deleted account.

**Role as an enum, not a join table.** A user has exactly one role, and it
drives authorisation on every request. An enum is a single byte, is checked by
the database, and Prisma types it end-to-end. If per-permission grants are ever
needed, a permissions table can be added alongside without changing this column.

**`status` separate from `role`.** Organisation and government accounts need
manual approval before they are trusted; citizens only need email verification.
Keeping lifecycle separate from role means the verification workflow does not
have to mutate a user's identity.

**`passwordHash` nullable.** An OAuth-created account genuinely has no password.
A sentinel value would be a lie the auth code would have to special-case anyway.

**Organisation profile is not on this table.** An NGO's registration number,
capability tags and service area belong to an `Organization` record that a user
belongs to — not to fifteen nullable columns that are null for every citizen.

**`fullName`, not `firstName`/`lastName`.** Many Indian names do not split
cleanly into two fields, and nothing in the product needs the halves separately.
A single field is both more correct and less to get wrong.

**`status` enum rather than an `isActive` boolean.** "Pending verification" and
"suspended" are different states with different consequences — an organisation
account awaiting approval is not the same as one that was shut down — and a
boolean cannot express that.

### `Session`

One row per signed-in device. Table `sessions`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Also the `sid` claim in access tokens |
| `userId` | `uuid` FK | `onDelete: Cascade` |
| `tokenHash` | `text` unique | SHA-256 of the refresh token |
| `userAgent` | `text?` | For a future "your devices" screen |
| `ipAddress` | `text?` | Same, and to spot session theft |
| `expiresAt` | `timestamp` | |
| `revokedAt` | `timestamp?` | Set on logout, rotation, or reuse detection |
| `createdAt` / `lastUsedAt` | `timestamp` | |

**Indexes:** unique on `tokenHash`; `userId`; `expiresAt`.

#### Decisions on this table

**Only a digest is stored.** Refresh tokens are 256 bits of randomness, so a
database leak yields nothing an attacker can replay — there is no token to
recover from a SHA-256 digest.

**SHA-256, not Argon2.** Argon2 is deliberately slow to resist brute force
against low-entropy human passwords. A 256-bit random token has nothing to
brute-force, and this is verified on every refresh, so a slow hash would only
add latency.

**Revoked, not deleted.** `revokedAt` is what makes refresh-token reuse
detectable: a deleted row is indistinguishable from one that never existed,
whereas a revoked row presented again is a signal that a token was captured.

**This table is why logout works.** Access tokens are stateless and cannot be
recalled, so revocation lives here. `JwtAuthGuard` confirms the session row on
every request — one indexed lookup, in exchange for revocation that is actually
true rather than "true in up to fifteen minutes".


---

## Planned later

Not implemented. Shapes are indicative and will be refined by the milestone that
builds each one.

### Core domain

**`Organization`** — profile for an NGO, university or industry: legal name,
registration number, type, verification status and evidence, capability tags,
service area (PostGIS polygon), contact details. Users belong to an organisation
with a membership role. *(Organisations milestone.)*

**`Problem`** — the central entity.

- Reporter, title, description, status, category, address
- `location geography(Point, 4326)` — PostGIS, with a GiST index for radius
  search and map clustering
- `embedding vector(1536)` — pgvector, with an HNSW index for duplicate
  detection and semantic search. Dimension must match `EMBEDDING_DIMENSIONS`.
- AI outputs stored **with their confidence and model version**, so a
  recommendation is never mistaken for a human decision and a model regression
  can be traced
- Denormalised `supporterCount` / `commentCount`, maintained transactionally —
  feed queries cannot afford to count rows per problem

*(Problem reporting milestone.)*

**`ProblemMedia`** — photos and evidence: object-storage key, dimensions,
capture EXIF, and a `vector` image embedding for visual duplicate detection.

**`ProblemDuplicate`** — a candidate pair with its similarity score, the signals
that produced it (text, image, geographic), and the human decision. Recording
rejected candidates is what makes threshold tuning possible.

### Community

**`Comment`** — threaded discussion, with `parentId` for replies and soft delete
for moderation.

**`Suggestion`** — a proposed solution, with endorsements.

**`Support`** — one row per user per problem, uniquely constrained. Merged
duplicates contribute their supporters here.

### Resolution

**`ResolutionRoom`** — created when government allocates a problem. Holds
participants, milestones, and the coordination timeline.

**`ProgressUpdate`** — free-text update from an organisation plus the structured
fields the AI Project Coordinator extracted, kept side by side so extraction can
be audited and re-run.

**`CompletionEvidence`** — submitted evidence, AI verification findings, and the
government decision that closed the problem.

### Impact

**`ImpactPoints`** — an append-only ledger of point awards, not a running total
on `User`. A balance that can only be recomputed from its history is auditable
and disputable; a mutable integer is neither.

**`Notification`** — in-app feed, with delivery state per channel.

### Index plan

| Index | Table | Why |
| --- | --- | --- |
| GiST on `location` | `Problem` | "Problems within 2 km" is the core map query |
| HNSW on `embedding` | `Problem` | Approximate nearest neighbour for duplicates |
| GIN trigram on `title` | `Problem` | Fuzzy title matching alongside vector search |
| `(status, createdAt)` | `Problem` | The default feed ordering |
| `(category, status)` | `Problem` | Organisation discovery filters |
| `(problemId, userId)` unique | `Support` | Enforces one support per user |

---

## Working with the database

```bash
npm run db:generate     # regenerate the Prisma client after a schema change
npm run db:migrate      # create and apply a migration in development
npm run db:studio       # browse data
```

Migrations live in `apps/api/prisma/migrations/` and are committed. The client is
generated into `apps/api/src/generated/prisma/` and is **not** committed — run
`npm run db:generate` after cloning.

### Prisma 7 notes

Prisma 7 moved the connection URL out of `schema.prisma`:

- the CLI reads `DATABASE_URL` via `apps/api/prisma.config.ts`
- the runtime client connects through `@prisma/adapter-pg`, receiving the URL
  from validated config in `PrismaService`

Both paths resolve to the same `DATABASE_URL`, so there is still one source of
truth.
