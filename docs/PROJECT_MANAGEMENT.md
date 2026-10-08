# Project Management

The deterministic plan inside a resolution room: the project, its tasks and
milestones, and progress counted from them (Prompt 18).

> **Scope.** People write the plan, and the system counts it. There are no
> AI-generated tasks, milestones, plans, progress summaries or reminders, no
> priority scoring, no verification of completed work, no impact points and
> no analytics. The AI Project Coordinator (Prompt 19) builds on what is here.

```
Allocation ACCEPTED ─┐
Problem IN_PROGRESS ─┼─ one transaction ─▶ Resolution room + Resolution project (PLANNED)
                     │
                     └▶ tasks · milestones · progress · activity ─▶ (Prompt 19: AI coordination)
```

---

## 1. Creation

The project is created **automatically, in the acceptance transaction**,
alongside the room (`openRoomInTransaction` → `createProjectInTransaction`):

```
BEGIN
  allocation PENDING → ACCEPTED
  problem    VERIFIED → IN_PROGRESS
  INSERT resolution_rooms          + ROOM_CREATED
  INSERT resolution_projects       + PROJECT_CREATED   (status PLANNED)
  audit: ALLOCATION_ACCEPTED, PROBLEM_STATUS_CHANGED, RESOLUTION_ROOM_CREATED
COMMIT
```

If the project cannot be created, nothing commits: the allocation stays
`PENDING` and there is no room. The e2e suite makes the insert fail to prove
this. An accepted allocation therefore never lacks a project.

- **Name:** `Resolve: <problem title>` (≤ 200 chars).
- **Description:** `Resolution project for "<title>", reported at <address>, <city>.`
  These are built deterministically from the problem, with nothing invented.
- **Start date:** the acceptance day, in India time. There is no target date
  until someone sets one.
- **References, not copies:** problem, allocation, room and both
  organisations are foreign keys. The trigger
  `resolution_projects_room_match` ensures they match the room.
- **One per room and per allocation:** both `roomId` and `allocationId` are
  `UNIQUE`.

The migration backfills a project for any room that already existed.

## 2. Project lifecycle

```
PLANNED ──▶ ACTIVE ──▶ COMPLETED
   │          │ ▲
   │          ▼ │
   │        PAUSED
   └──────────┴──────▶ CANCELLED   (reason required)
```

| From | To |
| --- | --- |
| PLANNED | ACTIVE, CANCELLED |
| ACTIVE | PAUSED, COMPLETED, CANCELLED |
| PAUSED | ACTIVE, CANCELLED |
| COMPLETED, CANCELLED | — (final; reopening is a future workflow) |

- `PROJECT_TRANSITIONS` and `canTransitionProject` in `@samadhaan/shared` are
  the single definition, and the API refuses anything else with 409. The client
  sends a target status, never a free-form state.
- **Work beginning starts the project.** The first task moved to
  `IN_PROGRESS` on a `PLANNED` project also moves the project to `ACTIVE`, in
  the same transaction.
- **COMPLETED** needs no open tasks (TODO, IN_PROGRESS or BLOCKED), and since
  Prompt 22 it is reached **only through resolution verification**:
  - the organisation submits completion evidence and requests verification;
  - the allocating office's approval completes the project and resolves the
    problem in one transaction;
  - an organisation moving its own project to COMPLETED gets 409.

  See [`RESOLUTION_VERIFICATION.md`](./RESOLUTION_VERIFICATION.md).
- **PAUSED** stops work: tasks cannot be started or completed until the
  project resumes. Planning edits are still allowed.
- **COMPLETED or CANCELLED** makes the whole plan read-only. So does a closed
  room.
- Each change writes `PROJECT_STATUS_CHANGED` (from, to, reason) to the
  activity, and `RESOLUTION_PROJECT_STATUS_CHANGED` to the audit log.

## 3. Tasks

| Field | Notes |
| --- | --- |
| `title` (≤ 200), `description` (≤ 4000) | Plain text |
| `status` | `TODO`, `IN_PROGRESS`, `BLOCKED`, `COMPLETED`, `CANCELLED` |
| `priority` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`; chosen by people, never scored |
| `assignedToId` | An **ACTIVE member of the assigned organisation**, checked on every write. Government officials and other organisations' members are refused (400) |
| `milestoneId` | Optional; must be in the same project (trigger) and not completed |
| `dueDate` | Calendar date, not before the project's start date |
| `startedAt`, `completedAt` and `completedById`, `cancelledAt` | Set by transitions |
| `version` | Optimistic concurrency |

### Task lifecycle

```
TODO ──▶ IN_PROGRESS ◀──▶ BLOCKED
  │          │               │
  │          ▼               │
  │      COMPLETED           │
  └──────────┴──────▶ CANCELLED ◀┘
```

Completed and cancelled tasks are final. Tasks are **never deleted**: a
mistaken task is cancelled, and cancelled tasks do not count towards progress.

### Overdue

`dueDate < today AND status ∉ {COMPLETED, CANCELLED}`, where *today* is the
calendar day in `Asia/Kolkata` (`projectToday()`). A task due today is not yet
overdue. Overdue is computed, never stored. The API and UI share the same
function, and the API returns the day it used.

### Attachments

A task can reference up to 10 files from the room's attachment store
(Prompt 17). The file is uploaded through the room, then linked. The same
rules apply: images or PDFs, checked by their bytes, served only to
participants. A file whose message was deleted disappears from the task too.
There is no evidence review or verification yet (Prompt 22). Spreadsheets
such as `.xlsx` are not accepted by the room's attachment types.

## 4. Milestones

A milestone has a title, a description, an optional due date (not before the
project start) and an optional completion. **Status is derived, never
stored**, by `milestoneStatus()`:

| Condition | Status |
| --- | --- |
| `completedAt` set | COMPLETED |
| Due before today | OVERDUE |
| Any of its tasks past TODO | IN_PROGRESS |
| Otherwise | UPCOMING |

- **Completing** needs every task in the milestone finished or cancelled
  (409 otherwise). It records who completed it and when, and notifies
  participants. A manager can **reopen** it.
- A task may belong to at most one milestone. Membership is optional, and a
  completed milestone accepts no new tasks.

## 5. Progress

```
task progress      = floor(completed ÷ (total − cancelled) × 100)    0 when nothing counts
milestone progress = floor(completed milestones ÷ milestones × 100)  0 with none
```

Floored, so 99.6% never reads as done. **There is no way to enter a
percentage.** The overview shows:
- status and progress;
- completed tasks out of countable tasks;
- completed milestones out of all milestones;
- overdue counts and the target date.

All of it is counted by the API in three grouped queries
(`ProjectsService.overviews`), which the dashboards batch for several projects.

## 6. Permissions

Access to a project is access to its room (`ResolutionAccessService`): the
allocating office's officials (role GOVERNMENT, active membership, operational
office, problem in jurisdiction) and the assigned organisation's active
members. **Everyone else gets 404**: other organisations, other offices,
citizens, and non-member administrators.

| | Org OWNER/ADMIN | Org MEMBER | Government officials |
| --- | --- | --- | --- |
| View project, tasks, milestones, activity | ✓ | ✓ | ✓ |
| Project name and description | ✓ | — | ✓ (the problem is theirs) |
| Project dates and status | ✓ | — | — |
| Create, edit, assign and cancel tasks | ✓ | — | — |
| Start, block or complete a task | Any task | **Own assigned tasks only** | — |
| Link files to a task | Any task | Own assigned tasks | — |
| Create, complete or reopen milestones | ✓ | — | — |

Government oversees and discusses changes in the resolution room; it does not
rewrite the organisation's plan. Each task's `allowedTransitions` and
`canEdit` are computed per viewer by the API, and the UI shows only those
controls. The API re-checks every one.

**Never accepted from the client:** `projectId` (outside the URL),
`createdById`, `organizationId`, `governmentOrganizationId`, `status` on
create or edit, or `completedById`. Unknown fields are a 400.

## 7. Concurrency

- **Project, task and milestone edits** carry the `version` the client read.
  The update is `WHERE version = ?`, so a stale edit is a 409 ("changed by
  someone else") and never a silent overwrite.
- **Status changes** are `WHERE status = <the status read>`. Two people
  completing the same task, or pausing the project, at once: one 200, one 409.
  The e2e suite tests both.
- **Milestone completion** is `WHERE completedAt IS NULL`.

## 8. Activity and timeline

Project events reuse **`resolution_room_events`**, so there is one activity
system and not two. The new types are:
- `PROJECT_CREATED`, `PROJECT_UPDATED`, `PROJECT_STATUS_CHANGED`
- `TASK_CREATED`, `TASK_UPDATED`, `TASK_ASSIGNED`, `TASK_STATUS_CHANGED`
- `MILESTONE_CREATED`, `MILESTONE_UPDATED`, `MILESTONE_COMPLETED`,
  `MILESTONE_REOPENED`

Each carries ids, a subject title and from/to values in its metadata. The
room's activity panel shows only room events, and the project page shows only
project events (paginated by cursor). The **timeline** is the key moments:
creation, status changes and completed milestones. Views are not recorded.

**Discussion stays in the room.** There is no project comment system; the
project page links to the room for conversation.

## 9. Notifications

These go through the existing event bus, planner and in-app channel. The
actor is never notified.

| Type | To | When | Dedupe |
| --- | --- | --- | --- |
| `PROJECT_TASK_ASSIGNED` | The assignee | Created with, or changed to, an assignee | Task and version |
| `PROJECT_TASK_DUE_SOON` | The assignee | Open task due today or tomorrow, in a live project | Task and due date (once) |
| `PROJECT_TASK_COMPLETED` | The task's creator | Someone else completes it | Task |
| `PROJECT_MILESTONE_COMPLETED` | All participants | Completed | Milestone and completion time |
| `PROJECT_STATUS_CHANGED` | All participants | Any project transition | The change |

**Due-soon** is a plain hourly sweep (`ProjectRemindersService`): a
deterministic date check, idempotent across instances through the dedupe key,
and disabled under test. It is not an AI reminder. Links go to
`/resolution/:roomId/project`.

## 10. Interfaces

- **`/resolution/[roomId]/project`**: the header (name, problem reference,
  category, status, both organisations, start, target, progress and the
  allowed status actions), an overview, tasks, milestones, a timeline and
  recent activity.
  - **Tasks** show as a **board** (To do, In progress, Blocked, Completed) or
    a **table** (Task, Status, Priority, Assignee, Due, Updated).
  - Every status change is a **button**; there is no drag and drop. Filters
    for status, priority, assignee and overdue run on the server.
  - **Phones** get tabs (Summary, Tasks, Milestones, Activity).
  - Room and project link to each other.
- **Dashboards:**
  - The organisation dashboard shows **My active projects**.
  - The government dashboard shows **Active projects**, with an
    `activeProjects` count.
  - Both show progress, task counts and overdue counts.
- **Accessibility:**
  - Progress bars have names.
  - Status, priority and overdue are always written in words.
  - The table has captions and row headers, and dialogs come from Radix.
  - Every control is keyboard reachable.

## 11. Future AI boundary

Prompt 19 (the AI Project Coordinator, now built — see
[`AI_PROJECT_COORDINATOR.md`](./AI_PROJECT_COORDINATOR.md)) *reads* tasks,
milestones, room messages and events, and *suggests*. Anything it proposes becomes real only
when a person creates or changes it through these same endpoints and
permissions. Progress stays arithmetic.
