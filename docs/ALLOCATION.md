# Government Allocation

How a government office assigns a verified civic problem to an organisation
that can act on it, and how that organisation accepts or declines (Prompt 16).

> **Scope.** Allocation and the response to it only. Resolution rooms,
> organisation–government chat, tasks, milestones, budgets, the AI project
> coordinator, progress questions, RAG, the AI priority model, completion and
> before/after verification, impact points, leaderboards and analytics are
> later milestones. Nothing here performs or imitates them.

---

## 1. Matching is not allocation

| | Organisation matching (Prompt 14) | Allocation (this document) |
| --- | --- | --- |
| Says | An organisation *appears* relevant | A government office *chose* it |
| Made by | The matching engine | An authorised official |
| Effect | A suggestion | An official request; on acceptance, the problem is in progress |

The government portal shows matches as **decision support only**, with the
note "Recommendations are AI-assisted suggestions. Final allocation is made by
an authorized government official." The official can choose any eligible
organisation, including one found by name that was never recommended. There is
no "allocate the top match" control and nothing allocates automatically: every
allocation is an official choosing an organisation and confirming a dialog
that says "This action sends an official allocation request to the selected
organization."

## 2. Data model

`problem_allocations` (`ProblemAllocation`), migration
`20261009090000_problem_allocation`:

| Column | Meaning |
| --- | --- |
| `problemId` | The problem (`ON DELETE RESTRICT` — a problem with allocation history cannot be hard-deleted) |
| `organizationId` | The organisation asked to act |
| `governmentOrganizationId` | The allocating office — from the session, never the client |
| `allocatedById` | The official — from the session, never the client |
| `status` | `PENDING`, `ACCEPTED`, `DECLINED`, `CANCELLED`, `EXPIRED` (reserved) |
| `instructions` | Shared with the organisation |
| `internalReason` | The office's own reasoning. Never shown to the organisation or the public |
| `responseNote` | Optional note with an acceptance |
| `declineReason` | Required with a decline; shown to the allocating office only |
| `respondedById`, `respondedAt`, `acceptedAt`, `declinedAt` | The response |
| `cancellationReason`, `cancelledById`, `cancelledAt` | A withdrawal |
| `proposedAt`, `createdAt`, `updatedAt` | |

Allocation status is separate from problem status. A problem is `VERIFIED`
while an allocation is pending and moves to `IN_PROGRESS` only when one is
accepted.

### Database guarantees

- **One active allocation per problem**: the partial unique index
  `problem_allocations_one_active ON (problemId) WHERE status IN ('PENDING',
  'ACCEPTED')`. It is also in `prisma/sql/post-migrate.sql`, because Prisma
  cannot express partial indexes.
- **Consistent timestamps**: the CHECK constraint
  `problem_allocations_state_consistent`. An `ACCEPTED` row needs
  `acceptedAt` and `respondedAt`; `DECLINED` needs `declinedAt`, `respondedAt`
  and `declineReason`; `CANCELLED` needs `cancelledAt`; `PENDING` has no
  response or cancellation time.

## 3. State machine

```
PENDING ──accept (org OWNER/ADMIN)──▶ ACCEPTED    problem VERIFIED → IN_PROGRESS
   │──────decline (org OWNER/ADMIN, reason)──▶ DECLINED   problem stays VERIFIED
   └──────cancel (allocating office)─────────▶ CANCELLED  problem stays VERIFIED
EXPIRED: reserved for a response deadline; nothing sets it yet.
```

`ALLOCATION_TRANSITIONS` and `canTransitionAllocation` in `@samadhaan/shared`
are the single definition. Only `PENDING` moves, and every end state is final.
After a decline or a cancellation the office can allocate again, to the same
or another organisation; every attempt stays in the history.

## 4. Who may do what

| Action | Who | Otherwise |
| --- | --- | --- |
| See the allocation panel, search candidates | Platform role `GOVERNMENT` + ACTIVE member of an operational `GOVERNMENT` office + problem in its jurisdiction | `403` role, `404` office or problem |
| Allocate | As above; problem `VERIFIED`; no active allocation; target eligible | `409` / `400` |
| Withdraw | The office that made the allocation, while `PENDING` | `404` another office's, `409` already decided |
| Read the inbox and a request | Any ACTIVE member of the target organisation | `404` |
| Accept, decline | That organisation's `OWNER` or `ADMIN`, while `PENDING` | `403` member, `404` another organisation, `409` already decided |

Platform `ADMIN` is not a government official and gets `403` on every
allocation route. Organisation workspace routes need membership, so an
administrator who is not a member gets `404`.

**Eligible targets** (`ineligibility()` in `allocations.service.ts`): type
`NGO`, `UNIVERSITY` or `INDUSTRY`; active; not deleted; verification status
`VERIFIED`. Suspended, rejected, unverified and pending organisations are
listed with the reason but cannot be selected, and the API refuses them
(`400`) whatever the UI does. Government offices are never candidates.

**Nothing identifying the actor comes from the client.** The office comes
from the slug plus the caller's membership, the official from the session, and
the responding organisation from the slug plus membership. The only id the
client sends is the chosen `organizationId`, and it is re-checked against the
database. The global validation pipe rejects unknown fields such as
`governmentOrganizationId`, `allocatedByUserId` or `status` with `400`.

## 5. Transactions and races

| Race | Mechanism | Result |
| --- | --- | --- |
| Two officials allocate the same problem | The problem row is locked (`SELECT … FOR UPDATE OF p`) for the create transaction, and the partial unique index catches anything else (`P2002` → `409`) | One `201`, one `409` |
| The organisation accepts while the office cancels | Both are `UPDATE … WHERE id = ? AND status = 'PENDING'`; the affected-row count decides | One `200`, one `409` naming what happened |
| Two members: one accepts, one declines | Same conditional update | One `200`; the other gets "This allocation was already responded to by another authorized user." |
| Acceptance when the problem is no longer `VERIFIED` | The `VERIFIED → IN_PROGRESS` update is conditional too, in the same transaction | Both updates roll back; `409` |

Each mutation writes its audit entry inside the same transaction. Events, and
the notifications they trigger, are published only after commit.

## 6. Notifications

Through the existing event bus and planner, in-app only. The actor is never
notified of their own action.

| Event | Recipients | Title | Link |
| --- | --- | --- | --- |
| `ALLOCATION_CREATED` → `ALLOCATION_REQUESTED` | Target organisation's active OWNERs and ADMINs | New allocation request | `/organization/:slug/allocations/:id` |
| `ALLOCATION_ACCEPTED` | Active `GOVERNMENT` members of the allocating office | Allocation accepted | `/government/:slug/problems/:publicId#allocation` |
| `ALLOCATION_DECLINED` | Same | Allocation declined | Same |
| `ALLOCATION_CANCELLED` | Target organisation's OWNERs and ADMINs | Allocation withdrawn | The allocation page |

On acceptance, the existing `PROBLEM_STATUS_CHANGED` event also runs, so the
reporter and followers learn the problem is in progress. Messages name the
office, the organisation and the problem reference, and contain no notes or
reasons. Dedupe keys are `<event>:<allocationId>`.

## 7. Audit

All in the append-only `audit_logs` (`entityType = 'Problem'`):
`ALLOCATION_CREATED`, `ALLOCATION_ACCEPTED`, `ALLOCATION_DECLINED`,
`ALLOCATION_CANCELLED`. Each records the actor, `allocationId`, the allocated
organisation's id and name, the office, `from` and `to`, and the stated note or
reason. An acceptance also writes `PROBLEM_STATUS_CHANGED` (`VERIFIED →
IN_PROGRESS`, `viaAllocation: true`). The government timeline names the
organisation as the actor for its own responses. Notes and reasons appear only
in the allocating office's portal.

## 8. Privacy

| Field | Allocating office | Another office over the same area | Organisation | Public |
| --- | --- | --- | --- | --- |
| Organisation chosen, status | ✓ | ✓ | ✓ | Only once accepted |
| `instructions` | ✓ | ✓ | ✓ | — |
| `internalReason` | ✓ | — | — | — |
| `declineReason`, `responseNote`, `cancellationReason` | ✓ | — | Its own | — |
| Official's name | ✓ | — (office name only) | — (office name only) | — |

The public problem page (`ProblemView.assignment`) shows only the accepted
organisation's slug, name, type and logo, plus the assignment date, labelled
"Government-assigned". There is no history, no reasons and no notes.

## 9. Interfaces

**Government portal:** an *Allocation* section on the problem page
(`#allocation`) with
- the active allocation and a *Withdraw* control for the owning office;
- recommended candidates with relevance, reasons, verification and
  "Declined this problem before";
- search by name;
- the confirmation dialog: shared instructions plus a government-only internal
  reason;
- the allocation history and the `AllocationTimeline`.

The dashboard counts pending, accepted and declined allocations.

**Organisation workspace:**
- `/organization/:slug/allocations`: tabs for awaiting response, accepted,
  closed and all.
- `/organization/:slug/allocations/:id`: the request, the problem, the
  timeline, and Accept/Decline dialogs. The decline reason is required, with
  example reasons offered.

The dashboard shows *Pending allocations* and *Active assignments*, plus an
alert while a request is waiting. The *Allocations* entry is in the sidebar
and the phone bar.

**Public problem page:** an *Assigned organisation · Government-assigned*
card, and the status *In progress*.

## 10. Not yet

- `EXPIRED` and response deadlines.
- Allocating to several organisations, or co-assignment.
- Reassigning after acceptance: an accepted allocation cannot be cancelled,
  and changing course after acceptance belongs to resolution.
- Finer government roles. Every active member of an office may allocate.
- Email or push delivery of allocation notifications.
