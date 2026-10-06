# Database

PostgreSQL 16+ with PostGIS, pgvector and pg_trgm. Prisma is the ORM.

---

## 1. Architecture

```
NestJS API ──Prisma──▶ PostgreSQL 16+
                          ├── PostGIS   geography(Point, 4326), GiST
                          ├── pgvector  vector(384), HNSW
                          └── pg_trgm   fuzzy title matching
```

Prisma is the only writer. The AI service never connects to PostgreSQL — it
receives work and returns results through the API, so authorisation, auditing
and validation stay in one place.

**Conventions**, applied throughout:

| | |
| --- | --- |
| Primary keys | UUID v4. Sequential ids in URLs leak volume and invite enumeration |
| Timestamps | `timestamptz(3)`, always UTC. A naive timestamp is ambiguous |
| Deletion | Soft (`deletedAt`) on anything with historical value |
| Vocabularies | Enums, mirrored into `@samadhaan/shared` for the frontend |
| Dynamic data | `JSONB`, used only where the shape genuinely is not ours |

---

## 2. ERD

```
User ─────────────────────────────────────────────────┐
 │                                                    │
 ├── Session                      (auth, Prompt 3)    │
 │                                                    │
 ├── Problem  (reporter, Restrict)                    │
 │     ├── ProblemImage               Cascade         │
 │     ├── ProblemAiAnalysis          Cascade         │
 │     ├── ProblemEmbedding           Cascade         │
 │     ├── ProblemDuplicateCandidate  Cascade  ×2     │
 │     ├── ProblemVote                Cascade         │
 │     ├── ProblemFollow              Cascade         │
 │     ├── ProblemComment             Cascade         │
 │     │     └── ProblemComment  (self, threaded)     │
 │     ├── ProblemSuggestion          Cascade         │
 │     └── Problem  (duplicateOf, self, Restrict)     │
 │                                                    │
 ├── ProblemVote · ProblemFollow      Cascade         │
 ├── ProblemComment · ProblemSuggestion  Restrict     │
 │                                                    │
 ├── OrganizationMember ── Organization ──────────────┘
 │         (Restrict)         (Cascade)     │
 │                                          └── ProblemSuggestion (SetNull)
 │
 └── AuditLog  (actor, SetNull)
```

---

## 3. Core entities

### Identity

**`User`** — one row per person. Extended this milestone with `bio`; the auth
fields from Prompt 3 are unchanged and RBAC still reads `role`.

Two decisions carried forward and worth restating:

- **`fullName`, not `firstName`/`lastName`.** Many Indian names do not split
  cleanly in two, and nothing in the product needs the halves separately.
- **`status` enum, not an `isActive` boolean.** "Pending verification" and
  "suspended" have different consequences; a boolean cannot express that. The
  `isActive` concept the brief asks for is `status = ACTIVE`.

**`Session`** — one row per signed-in device; SHA-256 digest of an opaque
refresh token. This is what makes logout real. See [ARCHITECTURE.md](./ARCHITECTURE.md).

### Profile fields

`User` carries `bio`, `city`, `state`, `country` and `postalCode`.

**Location is coarse by design.** City and state, never a street address, and no
coordinates. A civic platform benefits from "reports problems in Gurugram" — it
builds local credibility — but publishing where a reporter *lives* is a
different thing entirely. Problems carry precise geography; people do not.

Length caps exist as CHECK constraints as well as DTO rules: a migration or a
psql session bypasses `class-validator` entirely, and an unbounded `bio` is a
cheap way to store a megabyte per row.

### Organisations

**`Organization`** — an NGO, university, industry partner or government
department. Carries its own address and PostGIS point, so "organisations serving
this area" is a spatial query.

**`OrganizationExpertise`** — the areas an organisation works in. One row per
area, never a comma-separated string, because this is the input to organisation
matching: free text cannot be indexed, cannot be joined against a problem's
category, and drifts the moment two people spell "waste management" differently.

`category` reuses **`ProblemCategory`**, the same taxonomy problems use. Matching
an organisation to a problem is a comparison between the two, and a parallel
vocabulary would need a translation table that is wrong the first time either
side changes. Areas with no civic-problem equivalent — urban planning, education
— are expressed as `subcategory` under the closest category rather than by
forking the enum.

`level` is `INTERESTED | EXPERIENCED | SPECIALIST`, ordered weakest to
strongest, so the matcher can rank an organisation that has resolved fifty
drainage problems above one that has merely declared an interest.

Unique on `(organizationId, category)`: a second row for the same category would
make "which level applies here?" ambiguous. Re-declaring a category is therefore
an update, which is also what a user pressing *add* on something already listed
actually means.

**`OrganizationMember`** — the join table. A join table rather than a column on
`User` because membership is genuinely many-to-many: a researcher may belong to
a university *and* advise an NGO, each with a different `membershipRole`. Unique
on `(organizationId, userId)`.

`OrganizationMemberRole` (OWNER/ADMIN/MEMBER) is deliberately distinct from
`UserRole`. The platform role says what someone may do on Samadhaan; membership
role says what they may do inside one organisation.

### Problem — the centre

Everything downstream attaches to `Problem` through its own table rather than
widening it. Adding a capability therefore adds a table; it never migrates the
one row every feed query already touches.

| Group | Fields |
| --- | --- |
| Identity | `id` (UUID), `publicId` (`SAM-1023`) |
| Content | `title`, `description`, `category`, `subcategory` |
| Assessment | `status`, `severity`, `urgency`, `priorityScore` |
| Location | `address`, `city`, `state`, `country`, `postalCode`, `latitude`, `longitude`, `location`, `locationAccuracyM` |
| Engagement | `voteCount`, `commentCount`, `followCount` (denormalised) |
| Lifecycle | `submittedAt`, `resolvedAt`, `createdAt`, `updatedAt`, `deletedAt` |

**Severity and urgency are separate columns, not one score.** A collapsed
footpath is severe but not urgent at 3am; a live electrical cable is both.
Collapsing them is what makes triage queues wrong.

**Counters are denormalised deliberately.** The feed sorts and filters on them,
and counting child rows per problem per request does not survive a real feed.
They are maintained transactionally alongside the vote/comment rows, and a
CHECK constraint keeps them non-negative so a bug in that code fails loudly.

---

## 4. Public identifiers

`publicId` is `SAM-` plus a PostgreSQL sequence:

```sql
CREATE SEQUENCE problem_public_id_seq START WITH 1000;
ALTER TABLE problems
  ALTER COLUMN "publicId" SET DEFAULT 'SAM-' || nextval('problem_public_id_seq');
```

**Why the database generates it.** `nextval()` is atomic and never returns the
same value twice, even under concurrent inserts. Generating the number in Node
would need a read-then-write, and two citizens reporting simultaneously would
race. There is an e2e test that inserts ten problems concurrently and asserts
ten distinct references.

**Why it is not the primary key.** A sequential identifier in a URL leaks total
report volume and lets anyone enumerate every report. The UUID stays
authoritative; `publicId` is for humans.

In the Prisma schema the field is `@default(dbgenerated())` — the empty form.
Writing the expression out would make the column *required* in the generated
create input, defeating the purpose; the empty form tells Prisma "the database
supplies this, do not ask".

---

## 5. Geospatial strategy

`latitude` / `longitude` are `Decimal(9,6)` and are **the writable source of
truth**. `location` is `geography(Point, 4326)`, maintained by a trigger:

```sql
CREATE TRIGGER problems_location_sync
  BEFORE INSERT OR UPDATE OF latitude, longitude ON problems
  FOR EACH ROW EXECUTE FUNCTION sync_location_from_lat_lng();
```

**Why a trigger and not application code.** If both were written by the API they
could disagree — and a `location` that silently diverges from the coordinates
shown to the user is a bug nobody notices until a map is wrong. The trigger
makes divergence impossible.

**Why a trigger and not a generated column.** Prisma's migration engine does not
model generated columns and would report drift against them on every run.
Triggers are invisible to it.

**Why `Decimal` and not `Float`.** Coordinates are compared and grouped; binary
floating point makes both subtly unreliable. `(9,6)` gives about 11 cm.

**Indexing.** GiST on `location`, not B-tree on the coordinates. A B-tree cannot
answer "within 2 km of here" — it would scan one dimension and filter the rest.
Radius search and map clustering are core queries, so this matters.

> **PostGIS argument order:** `ST_MakePoint(longitude, latitude)`. Reversing them
> is the classic bug — it produces a point in the wrong hemisphere rather than
> an error.

Populating `location` from application code is never necessary. Write the
coordinates; the database does the rest.

### Map queries (Prompt 12)

No schema change was needed: the column, SRID 4326, the trigger and the GiST
index already existed. The map uses them as follows.

| Query | Shape | Index |
| --- | --- | --- |
| Viewport (`/problems/map`) | `location && ST_MakeEnvelope(w, s, e, n, 4326)::geography`, then `longitude/latitude BETWEEN` the exact edges | GiST, bitmap index scan — verified with `EXPLAIN` |
| Radius (`/problems/nearby`) | `ST_DWithin(location, point, radius)` | GiST |
| Distance | `ST_Distance(location, point)` on geography — metres on the spheroid | — (runs on the bounded result only) |
| Grid aggregation (`/problems/map/aggregate`) | `floor(longitude / cell), floor(latitude / cell)` keys, grouped, inside the same envelope filter | GiST for the filter |

The decimal range check after `&&` is deliberate: a geography envelope's sides
are geodesics, which bow slightly away from the straight edges a map draws, so
`&&` alone would include a sliver outside the visible rectangle.

Every map query is bounded by a viewport the API also bounds — 1.5° a side for
individual problems, 40° for aggregates — so the worst case is a known
rectangle, never "every problem". Viewports crossing the antimeridian are
refused rather than split; Samadhaan maps India.

---

## 6. Vector / embedding strategy

`ProblemEmbedding.embedding` is `vector(384)`, indexed with HNSW using
`vector_cosine_ops`.

**Why HNSW and not IVFFlat.** IVFFlat needs a training pass over existing rows
and degrades until rebuilt. Samadhaan's corpus grows continuously from empty,
which is precisely the case IVFFlat handles badly.

**Why the dimension is fixed — and what it costs.** pgvector can only build an
ANN index on a column of declared width, and approximate nearest-neighbour
search is the entire purpose of the table. 384 is the native width of the
configured encoder, `sentence-transformers/all-MiniLM-L6-v2`.

The column was originally declared 1536 in anticipation of an OpenAI-class
encoder this project does not use. Padding a 384-vector into it was rejected: it
wastes index space and makes a genuine dimension mismatch *look* correct.
Matching the column to the model keeps the two honest.

**Changing the embedding model** therefore means a migration plus a re-embed:

1. `ALTER COLUMN "embedding" TYPE vector(N)`, dropping the HNSW index first —
   it is bound to the column type — and letting `post-migrate.sql` recreate it.
2. Re-encode. Old rows are not deleted; retrieval filters on `modelName`, so
   they simply stop matching and become invisible until re-encoded.

> **The image-encoder question is now settled.** A 512-dimensional CLIP-class
> encoder does not fit, and the chosen exit is **a second table at its native
> width** (`problem_image_embeddings`, `vector(512)`, its own HNSW index) rather
> than projecting into this column. Projection loses information and couples two
> unrelated models to one width. See `ML_DUPLICATE_DETECTION.md` §6.
>
> Every row records `dimensions` and `modelName`, and retrieval filters on the
> model — so vectors from incompatible encoders are never compared, rather than
> producing a plausible-looking number with no meaning.

Writes go through raw SQL — Prisma cannot express the type, so the column is
`Unsupported(...)` and invisible to the client.

---

## 7. Duplicate detection data model

`ProblemDuplicateCandidate` stores one row per **ordered** pair: "the newer
problem `problemId` may duplicate the older `candidateProblemId`".

**Directional on purpose.** Merging is itself directional — the older report is
canonical and inherits the supporters of everything merged into it. A normalised
undirected pair would discard which came first, which is exactly the fact the
merge needs. The unique index on `(problemId, candidateProblemId)` prevents the
same comparison being stored twice; the reverse direction is a *different*
record and is permitted, because "A may duplicate B" and "B may duplicate A" are
different claims.

A CHECK constraint rejects self-reference.

**Rejected candidates are kept.** Without the negatives, the similarity
thresholds cannot be tuned — the false positives are the training signal.

Four signals are stored separately (`textSimilarity`, `imageSimilarity`,
`geographicSimilarity`, `categorySimilarity`) alongside the `combinedScore`, so
a bad merge can be traced to the signal that caused it. All are range-checked
0–1 in the database.

**The intended cascade** (implemented in the duplicate-detection milestone):
geography first via the GiST index, since it eliminates almost all candidates
for free; then vector similarity on the survivors; then image similarity; then
the weighted combination.

---

## 8. AI analysis storage

`ProblemAiAnalysis` is a separate table, not columns on `Problem`, for three
reasons:

1. Analyses are **re-run**, and a new result must not overwrite its predecessor.
2. Every result carries its own `confidence` and `modelVersion`, which flattened
   columns cannot.
3. A machine opinion must stay **visibly distinct** from the human-entered
   values on `Problem` — a reviewer has to be able to disagree with it.

Together these rows are also the training set for any future custom model.

`rawResult` is JSONB because its shape is genuinely the provider's to decide and
changes between versions. The typed columns beside it are the stable subset the
product commits to.

---

## 9. Indexing strategy

Every index below exists for a named query. There are no speculative ones.

| Index | Table | Serves |
| --- | --- | --- |
| `(status, createdAt)` | Problem | Default feed |
| `(category, status)` | Problem | Organisation discovery |
| `(status, priorityScore)` | Problem | Government triage queue |
| `(reporterId, createdAt)` | Problem | "My problems" |
| `(state, city, status)` | Problem | Regional dashboards |
| `(severity, urgency)` | Problem | Triage filters |
| GiST `location` | Problem, Organization | Radius search, clustering |
| GIN `title gin_trgm_ops` | Problem | Fuzzy matching during dedup |
| HNSW `embedding` | ProblemEmbedding | Semantic nearest neighbour |
| `(type, verificationStatus)` | Organization | Partner discovery |
| `(organizationId, status)` | OrganizationMember | Member lists |
| `(problemId, analysisType, createdAt)` | ProblemAiAnalysis | Latest analysis |
| `(processingStatus, createdAt)` | ProblemAiAnalysis | Job queue |
| `(status, combinedScore)` | DuplicateCandidate | Review queue |
| `(problemId, createdAt)` | ProblemComment | Thread loading |
| `(entityType, entityId, createdAt)` | AuditLog | Record history |

Unique constraints: `User.email`, `User.displayName`, `Organization.slug`,
`Problem.publicId`, `ProblemImage.storageKey`,
`(organizationId, userId)`, `(problemId, userId)` on votes and follows,
`(problemId, embeddingType, modelName)`, `(problemId, candidateProblemId)`.

One **partial** unique index — at most one primary image per problem:

```sql
CREATE UNIQUE INDEX problem_images_one_primary_per_problem
  ON problem_images ("problemId") WHERE "isPrimary" = true;
```

A plain unique on `(problemId, isPrimary)` would also forbid a second
*non*-primary image.

---

## 10. Constraints

18 CHECK constraints. Application validation is the first line, not the only
one — migrations, scripts and psql sessions all bypass the API.

| Constraint | Guards |
| --- | --- |
| Latitude −90..90, longitude −180..180 | Problem, Organization |
| `priorityScore >= 0`, counters `>= 0` | Problem |
| `duplicateOfId <> id` | Problem |
| Slug matches `^[a-z0-9]+(-[a-z0-9]+)*$` | Organization |
| `fileSize > 0`, dimensions positive | ProblemImage |
| `confidence` 0..1, `severityScore` 0..10 | ProblemAiAnalysis |
| All five similarity scores 0..1 | DuplicateCandidate |
| `problemId <> candidateProblemId` | DuplicateCandidate |
| `parentCommentId <> id`, non-empty body | ProblemComment |
| `dimensions > 0` | ProblemEmbedding |
| `endorsementCount >= 0` | ProblemSuggestion |

---

## 11. Deletion strategy

`ON DELETE` is chosen per relationship, never applied uniformly.

| Behaviour | Used for | Reason |
| --- | --- | --- |
| **Restrict** | Problem→reporter, Comment→author, Suggestion→author, Member→user | A citizen leaving must not erase the civic record they created |
| **Cascade** | Problem→images, analyses, embeddings, votes, follows, comments, suggestions, duplicate pairs | Meaningless without their problem |
| **Cascade** | Vote/Follow→user | Engagement signals, not authored content |
| **SetNull** | AuditLog→actor, Suggestion→organization, reviewer fields | The record must outlive the reference |

Soft delete (`deletedAt`) on `User`, `Organization`, `Problem`, `ProblemImage`,
`ProblemComment`, `ProblemSuggestion`. Hard deletion is effectively never used
in production; the Restrict constraints exist to make an accidental one fail
loudly rather than take history with it.

**Every read must filter `deletedAt: null`.** This is not enforced by the
database. `UsersRepository` centralises it for users; each repository added
later must do the same for its own table.

---

## 12. Audit strategy

`AuditLog` is append-only: actor, action, entity, JSONB metadata, IP, user agent.

`entityType`/`entityId` are loose strings rather than foreign keys — deliberately.
The log must outlive what it references, and a foreign key would either block the
delete or cascade the evidence away. `actorUserId` is `SetNull`, so an entry
survives the removal of the person who acted; there is a test for exactly that.

`action` is a string, not an enum: new actions arrive with every milestone and an
enum would need a migration each time for no integrity gain.

**Nothing writes to this table yet.** The audit service arrives with the
workflows that need it — allocation, verification, role changes.

---

## 13. Migration strategy

```
20260912082226_init                      Users, extensions
20260912120434_add_sessions              Auth sessions
20260912144258_core_domain_model         Problem and its satellites
20260912144900_problem_public_id_default Aligns the sequence default with the schema
20260913080353_profiles_and_expertise    Profile fields, OrganizationExpertise
20260913120000_embedding_dimension_384   Embedding width matches the text encoder
20261006090000_community_engagement      lastCommentAt, reply index, comment CHECKs (§14f)
20261006120000_notifications             Notification table, enums, indexes, CHECKs (§14g)
```

> The profiles migration is a worked example of the HNSW caveat below: Prisma
> proposed `DROP INDEX "problem_embeddings_vector_hnsw"`, that line was removed
> before applying, and `npm run db:post-migrate` confirmed the index survived.

Migrations are additive and committed. A clean database reproduces the full
schema — verified by replaying all four into an empty database.

### Raw SQL

Prisma's schema language cannot express everything. Where that is true, the
migration contains raw SQL: the sequence, the trigger and function, the partial
unique index, and all 18 CHECK constraints.

Two things were moved *into* `schema.prisma` once it turned out Prisma could
express them — the GiST indexes (`type: Gist`) and the trigram index
(`ops: raw("gin_trgm_ops")`). That matters because Prisma regenerates its diff
from the schema alone and proposes dropping anything it does not know about.

### The HNSW exception

Prisma has no syntax for HNSW, so `prisma migrate dev` **will** propose dropping
`problem_embeddings_vector_hnsw`. That is expected, not a fault.

It is handled by `prisma/sql/post-migrate.sql`, which is idempotent and applied
automatically:

```bash
npm run db:migrate          # prisma migrate dev && post-migrate
npm run db:migrate:deploy   # prisma migrate deploy && post-migrate
npm run db:post-migrate     # re-apply on its own
```

> When reviewing a generated migration, delete any `DROP INDEX
> "problem_embeddings_vector_hnsw"` line before applying it. The post-migrate
> script recreates the index either way, but leaving the drop in causes a
> needless rebuild.

### Extensions

`postgis`, `vector` and `pg_trgm` are declared in the Prisma datasource **and**
in `infrastructure/database/init.sql`. The two lists must stay identical, or
Prisma reports drift against a Docker-provisioned database.

`btree_gist` was deliberately *not* added. A composite `(category, location)`
GiST index would have required it and bought little — the spatial index narrows
to a geographically local set first, after which filtering by category is
trivial. One fewer extension to keep in sync.

---

## 14. Seed data

```bash
npm run db:seed
```

Creates 8 users (one per role plus extra citizens), 4 organisations, 5
memberships, 8 problems, 6 images, 4 AI analyses, 9 votes, follows (each
reporter on their own report, plus supporters), 3 comments including a threaded
reply, 2 suggestions and 2 audit entries.

It also writes 8 **development notifications**, every one keyed `seed:<n>` so
they are recognisable and re-seeding never duplicates them. In a running system
notifications only ever come from domain events.

**Counters are recounted, never invented.** `voteCount`, `followCount`,
`commentCount` and `lastCommentAt` are computed from the real rows at the end of
the seed. Earlier seeds hand-wrote figures such as 342 supporters with no rows
behind them; once support became a real action, the first click exposed that
(342 → 343 with one row present).

**Deterministic and idempotent.** Dates derive from a fixed epoch and new rows
get fixed UUIDs, so a clean database always ends up identical. Accounts are
matched on email rather than id — earlier seeds created them with random ids —
and the real id is read back and used for every relation, so the seed reconciles
with an existing database instead of failing.

The data demonstrates the relationships rather than just filling tables:

- One user belongs to **two** organisations, proving membership is many-to-many.
- Problems 1 and 6 are 37 m apart in the same category, so the duplicate
  candidate between them has a realistic basis.
- Problem 4 has both a `BEFORE` and an `AFTER` image, the pair resolution
  verification will later compare.
- One analysis is left `PENDING`, so the job-queue index has something to work on.
- `publicId` is never hand-assigned — the sequence supplies it, as in production.

Guarded by two independent conditions: `NODE_ENV` must not be `production`
**and** `ALLOW_DEV_SEED` must be `true`.

Placeholder image references are object-store keys such as
`dev/problems/<uuid>/before-1.jpg`. No binary data is stored in PostgreSQL — the
table holds metadata and a reference; the bytes belong in object storage.

---

## 14a. Profile architecture

### Two user shapes, not one

The API emits three distinct user serialisations, and the separation is the
point:

| Serializer | Audience | Carries |
| --- | --- | --- |
| `toPublicProfile` | anyone, including signed-out | identity, bio, coarse location, role, accepted memberships |
| `toOwnProfile` | the user themselves | the above **plus** email, phone, postal code, status, login timestamps, pending invitations |
| `toAuthenticatedUser` | auth endpoints | the session payload |

A single shape with optional private fields would leak the first time a handler
forgot to strip them. Two types make "this endpoint returns the public view" a
question the compiler answers.

**Public profiles show only `ACTIVE` memberships.** Publishing an outstanding
invitation would let anyone imply an affiliation by inviting someone who never
replied.

### Activity metrics: null, never a fabricated zero

Every count on a profile is computed from the database. Where the underlying
feature does not exist yet the value is `null` and the UI renders an em dash
with "Not yet available" — **not** `0`.

"We cannot measure this" and "we measured nothing" are different claims. Showing
the second when the first is true is a small lie that compounds into a
leaderboard nobody trusts. Currently `null`: `ProfileActivity.impactPoints`
(no ledger yet) and `OrganizationActivity.problemsResolved` (no resolution yet).

### Organisation contact privacy

`email`, `phone` and `address` are published **only for VERIFIED
organisations**, or to members who can edit. An unverified profile is an
unchecked claim; attaching contact details to one turns the platform into a
convenient vector for impersonating a civic body.

City and state stay public regardless — they are the coarse identity that makes
an organisation findable, not a way to reach it.

---

## 14b. Authorisation rules

Two layers of authority, deliberately distinct:

- **Platform role** (`UserRole`) — what someone may do on Samadhaan.
- **Membership role** (`OrganizationMemberRole`) — what they may do inside one
  organisation.

A citizen who owns an NGO is not a platform admin; a platform admin is not
automatically a member of anything. One column on `User` could never express
this, which is why `OrganizationMember` is a join table.

| Action | Who |
| --- | --- |
| View an organisation profile | Anyone, signed out included |
| Open the organisation workspace | ACTIVE members of an operational NGO / university / industry organisation — not platform admins, not government offices |
| Edit organisation details | OWNER, ADMIN, or platform ADMIN |
| Manage expertise | OWNER, ADMIN, or platform ADMIN |
| Invite members (as ADMIN or MEMBER) | OWNER, ADMIN, or platform ADMIN |
| Change or remove a MEMBER / ADMIN | OWNER, ADMIN, or platform ADMIN — never their own membership |
| Change or remove an OWNER, or grant OWNER | OWNER or platform ADMIN — never their own membership |
| Accept or decline an invitation | The invitee only |
| Change verification status, type, slug, `isActive` | **Nobody** through the workspace |
| Edit own profile | The user themselves |

An organisation whose `verificationStatus` is `SUSPENDED` or whose `isActive`
is false is **frozen for its members**: the workspace returns `403` and no
management action is allowed. A platform admin can still act on it.

All of it lives in `OrganizationAccessService`, which is exported so allocation
and resolution rooms reuse it rather than re-deriving a subtly different
definition of "may manage this organisation".

**Never inferred from the frontend.** `viewerPermissions` is sent so the UI can
hide unusable controls, but it is a *mirror* of the server's decision — every
mutating endpoint calls `assertCanManage` again.

### The last-owner invariant

An organisation with no OWNER has nobody who can appoint one, so it becomes
permanently unmanageable. Demoting or removing the last owner is refused —
including for a platform ADMIN, because the invariant protects the
*organisation*, not the actor.

Removal marks the membership `LEFT` rather than deleting it: membership history
is part of the organisation's record, and a deleted row cannot answer "who was
on the team when this problem was allocated?".

### Invitations

An invitation is an `OrganizationMember` row with `status = INVITED` — no new
table. The `(organizationId, userId)` unique constraint makes a duplicate
invitation impossible even under a race, and a former member is re-invited on
their old row, keeping its history. Accepting sets `ACTIVE` and `joinedAt`;
declining or withdrawing sets `LEFT`. Both are conditional updates on
`status = INVITED`, so a withdrawal and an acceptance cannot both win.

### Organisation audit entries

Workspace changes write to `audit_logs` in the same transaction as the change
(`entityType = 'Organization'`): `ORGANIZATION_PROFILE_UPDATED` (field names
only), `ORGANIZATION_EXPERTISE_SET` / `_REMOVED`, `ORGANIZATION_MEMBER_INVITED`,
`ORGANIZATION_INVITATION_ACCEPTED` / `_DECLINED` / `_WITHDRAWN`,
`ORGANIZATION_MEMBER_ROLE_CHANGED` (from/to), `ORGANIZATION_MEMBER_REMOVED`.
Metadata holds ids and roles — never emails, phone numbers or tokens.

### Workspace problem discovery

`GET /organizations/:slug/problems` is one parameterised statement:

- the organisation's expertise (a handful of rows) is passed in as an inline
  table via `unnest()` of four bound arrays and joined on category — no
  per-row subquery;
- the service area is `ST_DWithin` against the organisation's registered point
  (25 km), so the existing `problems_location_gist` index narrows first; without
  coordinates it is a case-insensitive city match;
- the latest completed `INITIAL_ANALYSIS` comes from a `LATERAL` join on
  `(problemId, analysisType, createdAt)`;
- "reported within N days" binds a cutoff computed in Node rather than
  comparing to `now()` — see §16, "timestamps and the session time zone";
- pagination is `LIMIT`/`OFFSET` over a total order ending in `publicId`, with
  a separate `count(*)` over the same predicate; `page` is capped at 200.

No schema change was needed: `organizations` already carried latitude,
longitude, the trigger-maintained `location` and its GiST index, and
`organization_members` already had `[organizationId, status]` and `[userId]`
indexes.

### IDOR

Every membership and expertise lookup is scoped by `organizationId` as well as
its own id. Without that, a manager of one organisation could edit another's
records by guessing an id. Tests cover both cases.

---

## 14c. Slug strategy

**Slugs are stable. Once assigned, a slug never changes** — not on rename, not
on re-verification.

A public profile URL may appear in a government record, a press mention or a
citizen's bookmark. Silently repointing it breaks every one of those. The cost
is that a renamed organisation keeps its old slug, which is the right trade for
a civic platform; there is a test asserting a rename leaves the slug alone.

Generation, in `slug.util.ts`:

1. Unicode decomposed and combining marks stripped, so `Pūrṇa Foundation`
   becomes `purna-foundation` rather than being mangled.
2. Collisions get a readable numeric suffix — `clean-city-2` — because that is
   what a person expects to see.
3. A pathological number of collisions falls back to a random suffix, which
   terminates in one step rather than scanning further.
4. A name with no Latin characters produces the stem `organization`.

**The uniqueness check is not a substitute for the database constraint.** Two
concurrent creations can both see a candidate as free; the unique index rejects
the loser and the caller retries. Checking first only keeps the common case from
producing an ugly suffix.

If vanity URLs are ever wanted, the extension is an `organization_slug_aliases`
table — which *preserves* old URLs rather than discarding them.

---

## 14d. Image storage

**No binary data in PostgreSQL.** `ProblemImage` holds metadata and a
`storageKey`; the bytes live in object storage. Binaries in the database bloat
the table, defeat its cache and make every backup enormous.

The domain never learns where the bytes are. `StorageService` is an abstract
class with four methods — `put`, `get`, `delete`, `exists`, `getUrl` — and
`ProblemsService` stores a *key*. Swapping the local driver for S3 is a change
to one factory in `storage.module.ts`; no problem logic, no migration.

`getUrl` is async from the outset even though the local driver answers
synchronously, because a real object store issues *signed* URLs. Making it async
later would have turned every call site into a refactor.

URLs are resolved on read rather than read from the stored `url` column: a
signed URL expires and a CDN hostname can change. The key is the durable fact.

### Storage keys

`problems/<year>/<month>/<32 hex>.<ext>`, generated server-side.

**The client's filename is never part of the path.** A user-supplied name
invites path traversal, collisions between two people uploading `photo.jpg`, and
leaks whatever the filename discloses. The original name is kept as metadata on
the row, where it is displayed but never resolved as a path.

The extension comes from the *detected* content type, so a file's real format
decides where it lands. Date-prefixed so a bucket stays browsable and lifecycle
rules can target a period; 128 bits of randomness so a key cannot be guessed.

`isSafeStorageKey` rejects `..`, absolute paths, backslashes, NUL bytes and
anything outside `[a-zA-Z0-9._/-]`. It runs on every read and write, not only at
creation — a key also arrives from the client at submission time.

---

## 14e. Reporting

A submitted problem is `SUBMITTED`, never `VERIFIED`. `severity`, `urgency` and
`priorityScore` keep their schema defaults: they are assessments the AI and a
reviewer make, and the reporting DTO has no field for any of them.

`publicId` comes from the PostgreSQL sequence (§4), so concurrent reports cannot
collide. `location` is populated by the database trigger from the submitted
coordinates (§5) — the API writes `latitude`/`longitude` and nothing else.

The problem and its `ProblemImage` rows are written in one transaction.

> **`ProblemAiAnalysis` is now written.** One row per analysis attempt, created
> `PENDING` immediately after the problem commits and updated through
> `PROCESSING` to `COMPLETED` or `FAILED`. A retry inserts a **new** row rather
> than updating the old one, so an earlier model's answer stays readable —
> `findLatest` orders by `createdAt` desc. `rawResult` holds only the publishable
> part of the result (provider, observations, image count, attempt number);
> prompts and private model reasoning are never stored.
>
> **`ProblemEmbedding` and `ProblemDuplicateCandidate` are now written too.**
> One `TEXT` embedding per problem per model, upserted on
> `(problemId, embeddingType, modelName)` — re-encoding with the same model
> replaces the row, while a different model writes a new one, so a model change
> cannot silently overwrite a corpus it can no longer be compared with.
>
> Duplicate candidates are directional (newer `problemId` may duplicate older
> `candidateProblemId`), unique per ordered pair, and store each component
> signal rather than only the combined score — that table is the feature store
> for the learned scorer in Prompt 28. A re-check retracts pairs it no longer
> supports, except those a human has ruled on. Rejected pairs are kept, never
> deleted: confirmed negatives are the scarcer half of any future training set.

---

## 14f. Community engagement

Prompt 10 reuses `ProblemVote`, `ProblemFollow` and `ProblemComment` as they
were modelled in Prompt 4 — no community tables were added. Migration
`20261006090000_community_engagement` adds only what the feature needed:

| Change | Why |
| --- | --- |
| `problems."lastCommentAt"` + descending index | "Recently discussed" without aggregating every comment on every feed request. Set in the comment-insert transaction; backfilled. |
| `problem_comments (parentCommentId, createdAt)` replaces `(parentCommentId)` | Replies are always read in order per thread; the composite answers that directly. |
| `CHECK (length(btrim(body)) BETWEEN 1 AND 2000)` | The API's length rule, held by the database too. |
| `CHECK (parentCommentId <> id)` | A comment cannot be its own parent. |

Unchanged and relied upon: `@@unique([problemId, userId])` on votes and follows
(the concurrency guarantee), `(problemId, createdAt)` and `(userId, createdAt)`
on comments, and the `problems_counts_non_negative` CHECK, which makes a counter
bug fail loudly rather than display a negative number.

**Counter maintenance.** `voteCount`, `followCount` and `commentCount` move in
the same transaction as the row that justifies them, by the number of rows
actually inserted, deleted or soft-deleted, using `SET x = x + n` (atomic under
the row lock, and leaves `updatedAt` alone). `commentCount` counts comments that
have not been removed.

**One level of replies** is enforced in the service, not the schema — the
adjacency list could hold deeper trees, and refusing them at write time keeps
that possible later without a migration.

Applied with `migrate deploy` rather than `migrate dev`: the HNSW index (§13)
reads as drift to `migrate dev`, which then proposes resetting the database.

---

## 14g. Notifications

One table, `notifications`, and two enums, `NotificationType` and
`NotificationEntityType`.

| Column | Notes |
| --- | --- |
| `recipientId` | FK to `users`, `ON DELETE CASCADE` — notifications belong to one person |
| `type` | Controlled enum; only events the product produces today |
| `title`, `message` | Rendered once, at creation, and stored. CHECK: 1–120 and 1–300 characters |
| `entityType`, `entityId` | What it is about. No FK: it points at different tables, and history should outlive a deleted comment |
| `metadata` | JSONB allow-list (public ids, comment id, similarity, statuses). CHECK: at most 2 KB |
| `dedupeKey` | Names the event. `UNIQUE (recipientId, dedupeKey)` makes creation idempotent |
| `readAt` | `NULL` = unread. No separate read-receipt table |

**Indexes** — chosen for the two queries that matter, nothing speculative:

| Index | Serves |
| --- | --- |
| `(recipientId, createdAt DESC, id DESC)` | The activity center and popover: newest first, keyset-paged |
| `(recipientId, readAt)` | Unread count and the Unread tab |
| `UNIQUE (recipientId, dedupeKey)` | Idempotent inserts |
| `(createdAt)` | Retention: purging old rows by age |

Standalone `recipientId` and `readAt` indexes were deliberately **not** added:
`recipientId` is the leading column of three indexes above, and `readAt` alone
is never queried without a recipient.

**Retention** is not implemented yet. The `createdAt` index is there so a
scheduled `DELETE … WHERE "readAt" IS NOT NULL AND "createdAt" < now() - interval '90 days'`
stays cheap when it is.

---

## 14h. Organisation matching (Prompt 14)

Migration `20261007090000_organization_matching`:

- **`organization_embeddings`** — one profile vector per organisation per
  model, mirroring `problem_embeddings`: `vector(384)`, `modelName`,
  `modelVersion`, `dimensions`, and `sourceHash` (SHA-256 of the encoded
  profile text, so unchanged profiles are never re-embedded). Unique
  `(organizationId, modelName)`; HNSW `vector_cosine_ops` index
  `organization_embeddings_vector_hnsw` (also in `post-migrate.sql`).
- **`organization_problem_matches`** — six signal columns (nullable: a signal
  can be unavailable), `finalScore`, `rank`, `matchingVersion`, embedding
  `modelName`/`modelVersion`, `status` (`CALCULATED`, `STALE`, `DISMISSED` — no
  acceptance or allocation states), and `explanation` JSONB holding reason
  codes, matched expertise and distance only. Unique
  `(problemId, organizationId, matchingVersion)`; indexes
  `(problemId, status, finalScore DESC)` and `(organizationId, status,
  finalScore DESC)` serve the two reads. Cascades with either parent.
- **`AnalysisType.ORGANIZATION_MATCHING`** — a matching run's lifecycle and
  provenance (candidates, matched, degraded signals, weights) is a
  `problem_ai_analyses` row, like every other AI job. Reads of analyses filter
  on `INITIAL_ANALYSIS`, so these rows do not surface as problem analyses.

Problem embeddings are shared: duplicate detection and matching both read and
write `problem_embeddings` through `problems/services/problem-embedding.store.ts`.

Writes are transactional per problem: all non-dismissed rows for the problem
are replaced, dismissals are carried onto the new version's row. Nothing
outside the matching service writes these tables, and no API accepts a score.
See [`ML_ORGANIZATION_MATCHING.md`](./ML_ORGANIZATION_MATCHING.md).

## 14i. Government portal (Prompt 15)

Migration `20261008090000_government_portal`:

- **Jurisdiction on `organizations`** — `jurisdictionType` (enum
  `JurisdictionType`), `jurisdictionName`, `jurisdictionBoundary`
  (`geography(MultiPolygon, 4326)`, GiST index `organizations_jurisdiction_gist`),
  `jurisdictionCities text[]`, `jurisdictionPostalCodes text[]`. Used only for
  `type = GOVERNMENT`. Boundary first, then cities, then postal codes; none →
  no access (fail closed). The predicate is applied to every government query.
- **`problem_internal_notes`** — problem, office, author (Restrict), body,
  `visibility` (enum `NoteVisibility`, only `INTERNAL`), `createdAt`; indexed
  `(problemId, organizationId, createdAt)`. Read only by the government API,
  for the office that wrote the note. Cascades with the problem and office.
- **`audit_logs` is append-only.** Trigger `audit_logs_append_only` refuses
  `UPDATE` and `DELETE`, except the actor foreign key's `ON DELETE SET NULL`
  and transactions that set `samadhaan.audit_maintenance = on` (used by test
  clean-up via `test/audit-maintenance.ts`). Government reads use the existing
  `(entityType, entityId, createdAt)` index.

Queue, metrics and trend queries rely on existing indexes —
`problems (status, createdAt)`, `(category, status)`, `(severity, urgency)`,
the GiST index on `location`, the trigram index on `title`, and
`problem_ai_analyses (problemId, analysisType, createdAt)` for the latest
analysis lateral join. No new problem indexes were needed.

The seed adds a jurisdiction to *Ward 12 Municipal Office* (a rectangle
around Gurugram) and a member-less *Jaipur Municipal Corporation*
(a rectangle around Jaipur) — development rectangles, not survey boundaries.

## 14j. Government allocation (Prompt 16)

Migration `20261009090000_problem_allocation`. Detail:
[`ALLOCATION.md`](./ALLOCATION.md).

- **`problem_allocations`**:
  - problem (Restrict), organisation, allocating office, allocating official,
    responder and canceller (all Restrict);
  - `status` (enum `AllocationStatus`: `PENDING`, `ACCEPTED`, `DECLINED`,
    `CANCELLED`, `EXPIRED` reserved);
  - `instructions` (shared) and `internalReason` (government-only);
  - `responseNote`, `declineReason`, `cancellationReason`;
  - `proposedAt`, `respondedAt`, `acceptedAt`, `declinedAt`, `cancelledAt`.

  Indexes: `(problemId, createdAt)` for a problem's history,
  `(organizationId, status, createdAt)` for the inbox, and
  `(governmentOrganizationId, status)` for office metrics.
- **One active allocation per problem**: partial unique index
  `problem_allocations_one_active ON (problemId) WHERE status IN ('PENDING',
  'ACCEPTED')`, repeated in `prisma/sql/post-migrate.sql` because Prisma
  cannot express it. A concurrent second insert fails with `P2002`, which the
  API maps to `409`.
- **CHECK `problem_allocations_state_consistent`**: each status carries its
  timestamps (and `DECLINED` its reason); `PENDING` carries none of the
  response or cancellation times.
- Notification enums gain `ALLOCATION_REQUESTED`, `ALLOCATION_ACCEPTED`,
  `ALLOCATION_DECLINED` and `ALLOCATION_CANCELLED`, and the entity type
  `ALLOCATION`.
- Problem status is unchanged by allocation except on acceptance, which moves
  `VERIFIED → IN_PROGRESS` in the same transaction as the allocation update.

Audit entries `ALLOCATION_CREATED`, `ALLOCATION_ACCEPTED`,
`ALLOCATION_DECLINED` and `ALLOCATION_CANCELLED` go to the append-only
`audit_logs` with `entityType = 'Problem'`.

As with every migration, Prisma's diff proposed dropping both HNSW indexes;
those statements were removed.

## 14k. Resolution rooms (Prompt 17)

Migration `20261010090000_resolution_rooms`. Detail:
[`RESOLUTION_ROOMS.md`](./RESOLUTION_ROOMS.md).

| Table | Purpose | Notable constraints and indexes |
| --- | --- | --- |
| `resolution_rooms` | One per accepted allocation: problem, allocation, office, assigned organisation, `status` (`OPEN`/`CLOSED`/`ARCHIVED`), close time, closer and reason | `allocationId` UNIQUE; trigger `resolution_rooms_accepted_allocation` (allocation must be ACCEPTED and match); CHECK `resolution_rooms_closed_consistent`; `(governmentOrganizationId, status)`, `(assignedOrganizationId, status)`, `(problemId)` |
| `resolution_messages` | Plain-text messages: author, author's organisation and side (fixed at write), `editedAt`, `deletedAt` (soft) | CHECK body 1–4000; `(roomId, createdAt, id)` for keyset pages |
| `resolution_message_mentions` | Structured mentions | PK `(messageId, userId)`; `(userId)` |
| `resolution_attachments` | File metadata; bytes in storage under `resolution/…` | `storageKey` UNIQUE; `(roomId, createdAt)`, `(messageId)` |
| `resolution_room_events` | System activity (never message text) | `(roomId, createdAt)` |
| `resolution_room_reads` | Per-participant read marker and first visit | PK `(roomId, userId)` |

- **Participants are not a table.** They are the ACTIVE members of the two
  organisations, resolved per request.
- **Rooms are never deleted by the application.** Their child rows cascade
  from the room for test clean-up only. Users are `Restrict` everywhere, so
  history keeps its authors.
- **The migration** backfills rooms for already-accepted allocations, and
  removes Prisma's usual proposal to drop the HNSW indexes.
- **Notification enums** gain `RESOLUTION_MESSAGE`, `RESOLUTION_MENTION` and
  `RESOLUTION_ROOM_CLOSED`, and the entity type `RESOLUTION_ROOM`.

## 14l. Resolution projects (Prompt 18)

Migration `20261011090000_resolution_projects`. Detail:
[`PROJECT_MANAGEMENT.md`](./PROJECT_MANAGEMENT.md).

| Table | Purpose | Notable constraints and indexes |
| --- | --- | --- |
| `resolution_projects` | One per room: references to the room, problem, allocation and both organisations; `name`, `description`, `status` (`PLANNED`/`ACTIVE`/`PAUSED`/`COMPLETED`/`CANCELLED`), `startDate`/`targetDate` (`date`), `startedAt`/`completedAt`/`cancelledAt`, `version`, `createdById` | `roomId` and `allocationId` UNIQUE; trigger `resolution_projects_room_match`; CHECK `resolution_projects_state_consistent` (status timestamps, target ≥ start, name 1–200); `(governmentOrganizationId, status)`, `(assignedOrganizationId, status)`, `(problemId)` |
| `resolution_milestones` | Title, description, `dueDate`, `completedAt`/`completedById`, `version`; status derived | CHECK completion pair and title length; `(projectId, dueDate)` |
| `resolution_tasks` | Title, description, `status`, `priority`, `assignedToId`, `milestoneId?`, `dueDate`, start/complete/cancel stamps, `version`, `createdById` | CHECK `resolution_tasks_state_consistent`; trigger `resolution_tasks_milestone_project` (the milestone is in the same project); `(projectId, status)`, `(projectId, dueDate)`, `(projectId, milestoneId)`, `(assignedToId, status)` |
| `resolution_task_attachments` | Links a task to an existing room attachment | PK `(taskId, attachmentId)`; `(attachmentId)` |

- **Activity events** extend `ResolutionRoomEventType` (`PROJECT_*`,
  `TASK_*`, `MILESTONE_*`) rather than adding a second event table.
- **Notification enums** gain five `PROJECT_*` types and the entity type
  `RESOLUTION_PROJECT`.
- **The migration** backfills a project for every existing room. It records
  no `PROJECT_CREATED` event: a new enum value cannot be used in the
  transaction that adds it.
- **Prisma's** proposal to drop the HNSW indexes was removed again.

## 14m. AI Project Coordinator (Prompt 19)

Migration `20261012090000_ai_project_coordinator`. Detail:
[`AI_PROJECT_COORDINATOR.md`](./AI_PROJECT_COORDINATOR.md).

| Table | Purpose | Notable constraints and indexes |
| --- | --- | --- |
| `project_ai_insights` | One row per analysis attempt, never overwritten: status (`COMPLETED`/`FAILED`), trigger (`MANUAL`/`SCHEDULED`), requester, `baselineHealth`, `health`, reason, summary, JSON `risks`/`blockers`/`suggestions`/`deadlines`/`signals` (ref-cited), `provider`, `modelName`, `modelVersion`, `promptVersion`, `processingMs`, `droppedItems`, `basedOnChangeAt`, `generatedAt`, `expiresAt` | CHECK `project_ai_insights_state_consistent`; `(projectId, status, generatedAt)` |
| `coordinator_questions` | Question, category, `fingerprint`, `targetRef`, `sourceRefs`, status (`OPEN`/`ANSWERED`/`DISMISSED`/`EXPIRED`), answer and answerer, dismisser, expiry | Partial unique `coordinator_questions_one_open (projectId, fingerprint) WHERE status = 'OPEN'` (also in `post-migrate.sql`); CHECK `coordinator_questions_state_consistent`; `(projectId, status, askedAt)`, `(projectId, fingerprint)` |
| `project_updates` | A person's structured update: summary, `completed[]`, `current[]`, `blockers[]`, `nextSteps[]` (text arrays), `source` (`MANUAL`/`AI_ASSISTED`), `aiModel` | CHECK summary 1–400; `(projectId, createdAt)` |

- **JSON columns, deliberately.** Findings are read as a unit, never queried
  field by field, so they are JSON rather than a dozen tables.
- **New enums:** `ProjectHealth`, `CoordinatorInsightStatus`,
  `CoordinatorTrigger`, `CoordinatorQuestionStatus` and `ProjectUpdateSource`.
- **New event and notification types:** the room-event type
  `PROJECT_UPDATE_POSTED`, and the notification types
  `PROJECT_COORDINATOR_ALERT` and `PROJECT_COORDINATOR_QUESTION`.
- **Prisma's** proposal to drop the HNSW indexes was removed again.

## 14n. Knowledge & RAG (Prompt 20)

Migration `20261013090000_knowledge_rag`. Detail:
[`KNOWLEDGE_MODEL.md`](./KNOWLEDGE_MODEL.md).

| Table | Purpose | Notable constraints and indexes |
| --- | --- | --- |
| `knowledge_sources` | A guideline, policy or document: type, visibility, owner, file or text, categories, city, ingestion status and versions | CHECK `knowledge_sources_scope_consistent`; `(visibility, status)`, `(organizationId, visibility)` |
| `knowledge_documents` | Extracted, cleaned text of one ingestion | Cascades from source |
| `knowledge_chunks` | Retrievable passage with `embedding vector(384)`, section, page, content hash, embedding model/version | **HNSW** `knowledge_chunks_embedding_hnsw`; **GIN** `knowledge_chunks_content_fts`; UNIQUE `(documentId, chunkIndex)` |
| `knowledge_answers` | One row per question: answer, status, model/prompt/embedding/retrieval versions, retrieved chunk ids, scores, timings | `(userId, createdAt)` |

- **New enums:** `KnowledgeSourceType`, `KnowledgeVisibility`,
  `KnowledgeIngestionStatus`.
- **Both vector and full-text indexes** are also kept in `post-migrate.sql`.
- **Access is enforced in the retrieval SQL itself.** See `RAG_SECURITY.md`.

## 15. Planned, not yet modelled

Completion evidence and verification, impact-point ledger,
comment reports for moderation, notification
preferences and delivery channels beyond in-app. Each attaches to `Problem`
through its own table.

Also deliberately absent: **organisation invitations** (no email infrastructure
yet — the extension point is `OrganizationMember.status = INVITED`, which
already exists and is already rendered), **avatar/logo uploads** (the columns
take URLs; object storage plugs in behind them without a schema change), and
**verification workflow** (the statuses exist and are displayed; no endpoint
writes them).

The one schema change to anticipate: `ProblemEmbedding` gains either a
projection step or a sibling table when image embeddings land (§6).

---

## 16. Working with the database

```bash
npm run db:generate         # regenerate the Prisma client
npm run db:migrate          # create + apply a migration, then post-migrate
npm run db:migrate:deploy   # apply pending migrations (CI/production)
npm run db:post-migrate     # re-apply non-Prisma objects
npm run db:seed             # development data
npm run db:studio           # browse
```

> **Known issue — timestamps and the session time zone.** With the pg driver
> adapter, timestamps Prisma supplies (`@default(now())`, explicit dates) are sent
> without a zone, and PostgreSQL reads them in the *session* time zone. On a
> database whose zone is not UTC (the development database is `Asia/Kolkata`),
> they are stored shifted by that offset. Prisma reads them back with the same
> shift, so the application sees correct times — but SQL comparing those
> columns with `now()` is off by the offset. Found in Prompt 12; not yet fixed.
> The fix is to run the session in UTC (e.g. `options=-c TimeZone=UTC` on the
> connection) together with a one-off migration correcting existing rows. Until
> then, compare Prisma-written timestamps with values that also went through
> Prisma, not with `now()`.

Migrations live in `apps/api/prisma/migrations/` and are committed. The client is
generated into `apps/api/src/generated/prisma/` and is **not** committed — run
`npm run db:generate` after cloning.

### Prisma 7 notes

Prisma 7 moved the connection URL out of `schema.prisma`: the CLI reads
`DATABASE_URL` via `apps/api/prisma.config.ts`, and the runtime client connects
through `@prisma/adapter-pg` with the URL from validated config. Both resolve to
the same variable.
