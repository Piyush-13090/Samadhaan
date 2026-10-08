# Impact points

A fair, auditable record of civic contribution (Prompt 23). People earn
Impact Points for **confirmed outcomes**:

- a report the government verified;
- a duplicate confirmed against a verified problem;
- a problem resolved by a verified project.

They earn none for raw activity.

Reputation, tiers and badges: [`REPUTATION_SYSTEM.md`](./REPUTATION_SYSTEM.md).

> Points are recognition, not currency. There are no financial rewards and
> no monetary incentives.

---

## 1. The ledger

`impact_point_transactions` holds one row per award:

| Field | Holds |
| --- | --- |
| `userId` | Who received the award |
| `amount` | Non-zero, at most ±10 000 |
| `type` | The transaction type |
| `reason` | Human-readable, e.g. "Your report SAM-1023 was resolved" |
| `entityType` / `entityId` | The task, milestone, project, problem or user it concerns |
| `problemId` | The problem behind it, for filters (not a foreign key) |
| `ruleVersion` | The rules in force |
| `idempotencyKey` | Unique |
| `actorUserId` | The administrator, for adjustments |
| `metadata` | Extra context |
| `createdAt` | When it was awarded |

- **Append-only.** A database trigger refuses UPDATE and DELETE; only an
  explicit maintenance session (`samadhaan.audit_maintenance`, used by tests
  and data-protection erasure) may change rows. A correction is a new
  transaction.
- **The ledger is the source of truth.** `user_impact_stats` holds
  `impactPoints` and `resolvedContributions`, updated **in the same
  transaction** as each insert and only when a row was actually inserted. It
  can be rebuilt from the ledger:

  ```sql
  SELECT "userId", sum(amount) FROM impact_point_transactions GROUP BY 1;
  ```

- **Every transaction answers:** why it was awarded (`reason`, `type`), which
  event caused it (`idempotencyKey`), which problem or project
  (`problemId`, `entityId`), when (`createdAt`), and under which rules
  (`ruleVersion`).

## 2. Point rules — `POINT_RULES_V1`

All values live in one place, `apps/api/src/impact/impact-rules.ts`. They are
a documented starting point, not tuned numbers.

| When | Who | Type | Points |
| --- | --- | --- | --- |
| A report is filed | Reporter | (none) | **0**. Filing alone earns nothing |
| The government verifies the report | Reporter | `PROBLEM_VERIFIED` | 20 |
| A reporter confirms their own report duplicates a **verified** problem (awarded when both are true) | That reporter | `DUPLICATE_IDENTIFIED` | 10 |
| The problem is approved as **resolved** (Prompt 22) | Original reporter | `PROBLEM_RESOLVED` (role reporter) | 30 |
| | Reporters of confirmed duplicates of it | `PROBLEM_RESOLVED` (role corroborator) | 10 |
| | Early substantive commenters (comment of 20+ characters, before verification) | `USEFUL_COMMENT` | 5 |
| | Early supporters (before verification) | `PROBLEM_SUPPORTED` | 2 |
| | Members of the assigned organisation who completed tasks | `TASK_COMPLETED` | 5 each |
| | …and milestones | `MILESTONE_COMPLETED` | 5 each |
| | Submitters of approved evidence | `RESOLUTION_EVIDENCE_SUBMITTED` | 10 |
| | …if the AI review rated it 80+ quality | `QUALITY_BONUS` | 5 |
| | The manager who requested the approved verification | `PROJECT_CONTRIBUTION` | 10 |
| An administrator corrects a record | The affected user | `ADMIN_ADJUSTMENT` | ±1–1000 |

`PROBLEM_REPORTED` and `PENALTY` exist in the enum for future rules; neither
is awarded today. Nothing is deducted automatically.

### Caps

| Cap | Limit |
| --- | --- |
| Verified-report awards per user | 20 per rolling 30 days |
| Duplicate identifications per user | 10 per rolling 30 days |
| Community awards per user | 30 per rolling 30 days |
| Community contributors credited per resolved problem | 25 |
| Task awards per user per project | 3 |
| Task awards per project | 20 |
| Milestone awards per user per project | 2 |

### Versioning

Each transaction stores `ruleVersion`. To change values, add
`POINT_RULES_V2` and point `CURRENT_RULES` at it:

- **Existing rows keep their version and amount.** History is never
  recalculated silently.
- **Idempotency keys do not include the version,** so a new version never
  re-awards a past event.

## 3. Contribution attribution

`ContributionAttributionService`, with the pure `attributeResolution`
function, decides who earns what when a problem is resolved. The same record
always produces the same awards.

- **Community credit** goes to the earliest contributors (by first support or
  comment), up to 25.
- **Excluded from community credit:** the reporter, members of the assigned
  organisation (credited for project work instead), corroborating reporters,
  and inactive or deleted accounts.
- **Project credit** goes only to active members of the assigned
  organisation, for completed tasks and milestones, within the caps.
- **Officials earn nothing for their decisions:** verifying, approving or
  allocating.

## 4. Idempotency and concurrency

- **Every award has a unique key,** of the form `type:entity:user[:role]`.
  Examples: `PROBLEM_VERIFIED:{problemId}:{userId}`,
  `PROBLEM_RESOLVED:{problemId}:{userId}:reporter`,
  `TASK_COMPLETED:{taskId}:{userId}`.
- **Inserts are `INSERT … ON CONFLICT ("idempotencyKey") DO NOTHING`.** A
  replayed or retried event, or two workers processing `PROBLEM_RESOLVED` at
  once, inserts at most one row. This is enforced by the database's unique
  constraint, not an application check.
- **Each user's awards run in a transaction holding
  `pg_advisory_xact_lock(hashtext('impact:'||userId))`.** Caps are counted
  under the lock, so concurrent awards cannot both slip under a cap.
- **Badges** are `UNIQUE (userId, badgeKey)`; awarding one is idempotent.
- **Notifications** carry de-duplication keys (§6).

## 5. When awards happen

`ImpactEventHandler` listens on the domain event bus:

| Event | Effect |
| --- | --- |
| `PROBLEM_STATUS_CHANGED → VERIFIED` | Verified-report award; duplicates waiting on this problem are re-checked |
| `→ DUPLICATE` | Duplicate-identification award, if the reporter confirmed it and the original is verified |
| `→ RESOLVED` | Attribution (§3) |
| `→ REJECTED` | Reporter's reputation recomputed. No points either way |
| `VERIFICATION_DECIDED` (rejected) | Evidence submitters' reputation recomputed |

**Reconciliation.** The bus is in-process, so an event in flight during a
crash is lost. A bounded sweep (`IMPACT_RECONCILE_MINUTES`, default 60, and
on start-up) finds verified and resolved problems whose awards are missing
and runs the same, idempotent attribution. Seeded data earns points this
way, from its real states; no points are seeded.

**Tests.** Awarding is off under `NODE_ENV=test`, because other suites verify
and resolve problems filed by seed accounts and the ledger cannot be cleaned
casually. The impact suite turns it on for its own app.

## 6. Notifications

Only meaningful achievements notify:

| Type | Sent when | De-duplication key |
| --- | --- | --- |
| `IMPACT_POINTS_AWARDED` | At most one per user per source event, and only for 10+ points ("You earned 30 Impact Points. SAM-1023 was resolved.") | `impact:{event}` |
| `BADGE_EARNED` | Once per badge | `badge:{key}` |
| `REPUTATION_TIER_REACHED` | Once per tier, upward only | `tier:{tier}` |

All link to `/profile/impact`.

## 7. Anti-gaming

| Abuse | Safeguard |
| --- | --- |
| Report spam | 0 points for filing. Points only on government verification, capped at 20 per 30 days. Reporting is rate-limited (20 per hour) |
| Comment spam | Comments earn nothing by themselves; only an early, 20+ character comment on a problem later resolved, capped per problem and per user |
| Support farming | Support earns 2 points only if it came before verification and the problem was resolved. The reporter's support on their own problem never counts |
| Follow farming | Follows earn nothing |
| Duplicate farming | Only a confirmed duplicate of a *verified* problem, confirmed by its own reporter, against someone else's report, capped. Duplicate decisions are rate-limited |
| Fake project activity | Tasks, milestones and evidence earn only when the government approves the resolution, only for active members of the assigned organisation, capped per user and per project. Completed and cancelled are terminal task states, so back-and-forth changes earn nothing |
| Repeated transitions and events | Idempotency keys |
| Self-dealing | Officials earn nothing for their own decisions; admins cannot adjust their own points |

Existing rate limits on support, comments, evidence and verification
requests still apply.

## 8. Administrative adjustments

`POST /api/v1/admin/users/:id/impact/adjust` takes `{ amount (±1–1000), reason (10–500) }`:

- **Platform administrators only.** Government officials and organisation
  owners get 403.
- **Never one's own points.**
- **Each adjustment is a new `ADMIN_ADJUSTMENT` transaction** with
  `actorUserId`, plus an `IMPACT_POINTS_ADJUSTED` audit entry. Nothing is
  edited or deleted.

## 9. APIs

- `GET /users/me/impact?filter&page&limit`
- `GET /users/me/reputation`
- `GET /users/me/badges`
- `GET /users/me/contributions`
- `GET /leaderboard`
- the admin adjustment (§8)

Details are in [`API.md`](./API.md#impact-points-reputation-and-leaderboard-prompt-23).
There is no endpoint through which a user creates, edits or deletes points or
badges, and request bodies cannot carry them (`forbidNonWhitelisted`).

## 10. Leaderboard

`GET /leaderboard?period=week|month|year|all&city&state&category&page&limit`
is public.

- **Aggregated in SQL** and ranked with `RANK()`, never in Node:
  - all-time and unfiltered reads `user_impact_stats`;
  - periods and filters `SUM` the ledger, indexed on `createdAt`, `userId` and
    `problemId`, joined to problems for city, state and category.
- **Paginated:** at most 50 per page.
- **Cached** for `LEADERBOARD_CACHE_SECONDS` (60). The cache holds only
  public data; viewer marking is applied per request.
- **Public fields only:** display name (or full name, as on the public
  profile), avatar, points, reputation score and tier, resolved
  contributions, and up to three badges.
  - Never email, phone, account data, user ids or anything internal.
  - Suspended and deleted accounts are excluded.
- **Fairness.**
  - Reputation and resolved work are shown beside points, because time spent
    is not impact.
  - Period, city and category views let a ward-level contributor be seen.
- **Organisations are not ranked.** Organisation performance is a later
  milestone.

## 11. Known limitations

- **Suggestions have no acceptance workflow,** so "accepted suggestion"
  rewards cannot exist yet.
- **Comments have no "helpful" marking.** Usefulness is approximated by
  timing, length and outcome.
- **The ledger trusts upstream decisions.** A wrongly verified problem earns
  points until an administrator corrects it.
- **Time-period leaderboards aggregate the ledger per request,** cached
  briefly. At large scale this needs materialised snapshots.
