# Government Portal

The government side of Samadhaan: where officials of a municipal body or public
authority inspect, verify and understand the civic problems in **their**
jurisdiction (Prompt 15).

> **Scope.** Review and civic intelligence. Allocating a verified problem to an
> organisation was added in Prompt 16 — see [`ALLOCATION.md`](./ALLOCATION.md).
> Resolution rooms (Prompt 17) — see [`RESOLUTION_ROOMS.md`](./RESOLUTION_ROOMS.md).
> Applications, project management, the AI
> priority engine, verification of completed work, impact points and the
> analytics platform are later milestones. Nothing here performs or imitates
> them.

---

## 1. Who gets in

Three conditions, all checked by the API on every request:

```
platform role GOVERNMENT                (@Roles('GOVERNMENT') on the controller)
  → ACTIVE membership of a GOVERNMENT organisation, by slug   (GovernmentGuard)
  → that organisation is operational: not suspended or deactivated
  → the problem is inside its jurisdiction                     (every query)
```

- **A government user is not an administrator.** Platform `ADMIN` is not in
  the `@Roles` list and is refused (`403`): an administrator is not an official
  of any jurisdiction. Nothing in the portal widens a government user's access
  outside it.
- **Not a member, unknown office, or a non-government organisation → `404`**,
  indistinguishably, so the portal cannot be used to discover offices.
- **Suspended office → `403`** with an explanation (the member is entitled to
  know why).
- Every active member of an office may review and add notes. Finer review
  roles can come with allocation, where decisions carry more weight.

Government offices reuse the existing `Organization` model
(`type = GOVERNMENT`) and `OrganizationMember` — no second user architecture.

## 2. Jurisdiction

Organisation columns added in migration `20261008090000_government_portal`:

| Column | Purpose |
| --- | --- |
| `jurisdictionType` | `MUNICIPAL_CORPORATION`, `MUNICIPALITY`, `DISTRICT_ADMINISTRATION`, `URBAN_LOCAL_BODY`, `GOVERNMENT_DEPARTMENT`, `PUBLIC_AUTHORITY` |
| `jurisdictionName` | Human name of the area |
| `jurisdictionBoundary` | `geography(MultiPolygon, 4326)`, GiST-indexed |
| `jurisdictionCities` | Fallback: city names, case-insensitive |
| `jurisdictionPostalCodes` | Fallback: postal codes |

`resolveJurisdiction` turns these into one SQL predicate over a problem, in
order of precedence:

1. **Boundary** — `ST_Covers(boundary, p.location)`; the boundary is read once
   and the GiST index on `problems.location` narrows candidates.
2. **Cities**, then **postal codes**.
3. **Nothing defined → `false`.** An office whose area was never set up sees no
   problems, never every problem in the country (fail closed).

The predicate is the authorisation: it is part of every list, count, detail,
nearby, activity, audit and map query. Client filters (`city`, a viewport)
only narrow inside it; `?city=` is never an authorisation mechanism. A problem
outside the jurisdiction is answered exactly like a problem that does not
exist (`404`).

There is no API to set a jurisdiction yet; offices are configured by
Samadhaan (the seed shows how, with `ST_MakeEnvelope`).

## 3. Review queue and status transitions

The queue is `SUBMITTED` + `UNDER_REVIEW`. The portal orders it by
**priority** by default (Prompt 21). That is the effective tier (an
official's override, else the AI priority engine's tier), then score, then
longest waiting, grouped under tier headings; unassessed reports are listed
last, never hidden. Other orders: most severe then longest waiting (the API
default, `queue`), severity, urgency, newest, oldest and most supported. See
[`AI_PRIORITY_ENGINE.md`](./AI_PRIORITY_ENGINE.md). Filters: priority tier
(or not yet assessed), status (any but `DRAFT`, with *All reports*), severity,
category, subcategory, city, area (address words), reported from/to, duplicate
state (`possible` — open candidates from duplicate detection; `confirmed`;
`none`), AI analysis state, and basic search (reference, title, description,
address, category). All server-side with `page`/`limit` and a total count.

Transitions (`GOVERNMENT_REVIEW_TRANSITIONS`, shared by API and UI):

```
SUBMITTED    → UNDER_REVIEW
UNDER_REVIEW → VERIFIED
UNDER_REVIEW → REJECTED      (a reason is required)
```

Anything else — including `VERIFIED → IN_PROGRESS` and `→ RESOLVED`, which
belong to allocation and resolution — is `409`. A problem reaches
`IN_PROGRESS` only when an organisation accepts an allocation
([`ALLOCATION.md`](./ALLOCATION.md)). The update is conditional on
the status the reviewer saw, so two simultaneous decisions cannot both
succeed; the second gets `409`. Each transition writes an audit entry in the
same transaction and publishes the existing `PROBLEM_STATUS_CHANGED` event:

- the reporter is told — "SAM-1023 has been verified by Gurugram Municipal
  Corporation", or that it was reviewed and not accepted — and followers get
  the existing follower notification;
- the reviewer's note is **not** included in any notification;
- organisation matching re-runs, so a rejected problem loses its
  recommendations.

## 4. Internal notes

`problem_internal_notes`: problem, office, author, body, `visibility =
INTERNAL` (the only value, as an enum so a future "shared with the allocated
organisation" level is an addition). A separate table — never a column on
`problems` — so no public read can include one. Only the government API reads
notes, filtered to the office that wrote them: an official who belongs to two
overlapping offices sees each office's notes only in that office's portal.
Notes are append-only. Their creation is audited by id, never by text.

## 5. Audit trail

`audit_logs` is **append-only at the database**: a trigger refuses `UPDATE`
and `DELETE`, except

- the foreign key's own `ON DELETE SET NULL` when an actor's account is
  removed (only `actorUserId → NULL`, nothing else changed), and
- a transaction that explicitly sets `samadhaan.audit_maintenance = on`
  (test clean-up; future data-protection erasure).

Review entries record actor, action (`PROBLEM_STATUS_CHANGED`,
`PROBLEM_NOTE_ADDED`), problem, `from`, `to`, the note, and the office. The
portal shows them as a timeline: officials of the same office are named; a
reporter or another office is described by role only; a review note is shown
only to the office that wrote it.

## 6. Problem detail

One request (`GET …/problems/:publicId`): the report and images; the latest
AI analysis with **model, version, analysis time and status** (confidence only
when the model reported one; observations, never reasoning); possible
duplicates with their signals and distance, labelled as *possible*, and any
confirmed duplicate; community evidence (supporters, followers, comments —
presented as interest, not validity); location with coordinates and other
reports within 1 km inside the jurisdiction; allowed transitions; internal
notes; audit. Potentially relevant organisations come from Prompt 14's public
matches endpoint.

## 7. Map

`GET …/map` and `…/map/aggregate` are Prompt 12's `ProblemMapService` with a
`MapScope` appended — the jurisdiction predicate and the review filters
(status incl. rejected/duplicate, duplicate state, AI state, last 7/30/90
days). Same SQL, same GiST use, same GeoJSON. The web map is Prompt 12's
`MapExplorer` with an injected data source, opening on the jurisdiction's
extent, with links to the review page and the synchronised accessible list.
A viewport outside the jurisdiction returns nothing.

## 8. Dashboard

`GET …/dashboard?range=7|30|90`: ten counts from a single `FILTER`-aggregated
scan of the jurisdiction; a daily series of reports and resolutions from two
grouped counts merged onto every day of the range (quiet days are zero, not
missing); the top six of the review queue; the eight latest audit entries.
Nothing is computed in the browser.

## 8a. Resolution verification

On a problem in progress or resolved, the review page shows **Resolution
verification**:

- the original problem and photos;
- the project's progress;
- every submitted evidence item, with raw files and the advisory AI review;
- the expected-evidence checklist and the history;
- for the allocating office, the decision: approve (optional note), request
  more evidence (reason), or reject (reason).

Approval resolves the problem and completes the project in one transaction.
See [`RESOLUTION_VERIFICATION.md`](./RESOLUTION_VERIFICATION.md).

## 9. Not yet

- No UI or API to define a jurisdiction; no finer review roles.
- Government notifications ("new report in your area") are not sent:
  without per-official preferences they would be noise.
- ~~Day buckets in the trend inherit the database time-zone issue documented in
  `DATABASE.md` §16.~~ Fixed in Prompt 24: the trend groups by local day in
  `ANALYTICS_TIMEZONE`, correcting for the session offset
  (see [`ANALYTICS_ARCHITECTURE.md`](./ANALYTICS_ARCHITECTURE.md) §3).
