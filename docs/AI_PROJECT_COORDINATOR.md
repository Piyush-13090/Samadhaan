# AI Project Coordinator

An advisory assistant over each resolution project. It reads the project's
real state and says what is happening, what is blocked, what needs attention,
and what to ask the team (Prompt 19).

> **It advises; it never acts.** It cannot:
> - assign tasks, or change task or project status;
> - allocate, approve or verify work;
> - declare a problem resolved;
> - post as anyone.
>
> It writes only its own records: insights, questions, and — once a person
> confirms a draft — a structured update in that person's name.
>
> **Knowledge (Prompt 20):** the coordinator receives up to
> `RAG_COORDINATOR_TOP_K` passages of PUBLIC and this project's PROJECT
> knowledge as *untrusted reference material* (prompt
> `coordinator-2026-10-v2`), and a finding may cite one (`kind: 'knowledge'`,
> shown as "Guidance"). See [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md) §5.
>
> **Not built yet:** the civic priority engine (Prompt 21), verification
> (Prompt 22), impact points and analytics.
> Project *health* is not civic *priority*: they are separate systems.

---

## 1. Architecture

```
Next.js ──▶ NestJS ─────────────────────────────────────────▶ FastAPI ──▶ LLM provider
            │ access (room/project rules)                      │ prompt construction
            │ CoordinatorContextService: bounded context DTO   │ provider.generate(...)  (constrained output)
            │ health engine (deterministic, live)              │ validate_insight: ground every ref,
            │ AiService.coordinateProject → re-validate refs   │   bound health, drop repeats
            │ persist insight · questions · notifications      │ no database access
            │ CoordinatorSchedulerService (background)         │
```

**NestJS owns** authorisation, context construction, the health engine,
persistence, question de-duplication, notifications and scheduling. **Python
owns** prompts, the model call and the first validation pass. Python never
touches the database; NestJS validates again before persisting.

**Provider abstraction.** The existing `VisionLanguageProvider` in the AI
service gains one generic method:

```
generate(system_prompt, user_message, output_type, development_fallback=None) -> output_type
```

Business logic never names a vendor.
- **`anthropic`** uses constrained decoding (`messages.parse` with the Pydantic
  output type), so what comes back is already schema-valid.
- **`development`** (the local default, with no API key) runs **no model**. It
  returns the caller's deterministic result: the signals restated, keyword
  sentence-sorting for drafts, and blockers spotted by keywords in messages.
  Its output says so ("Development provider — no AI model ran"), and it is
  stored with `provider = development` and `modelName =
  development-keyword-stub`.
- **No provider configured** returns 503. Insights are never fabricated.

## 2. Context

`CoordinatorContextService.build` assembles a dedicated DTO, not database
rows. Every item carries a **ref** (`task:<id>`, `milestone:<id>`,
`event:<id>`, `message:<id>`, `update:<id>`, `question:<id>`,
`signal:<CODE>:<n>`), which findings must cite.

| Section | Contents | Limit (env) |
| --- | --- | --- |
| Problem | Reference, title, description (≤ 1500 chars), category, severity, urgency, coarse area, AI summary | — |
| Project | Name, status, start and target dates, progress, task counts | — |
| Tasks | Every open task (≤ 150) plus recently completed ones: title, status, priority, assignee **first name**, due date, overdue days, milestone, days since last change | `COORDINATOR_MAX_COMPLETED_TASKS` (10) |
| Milestones | Title, derived status, due date, task counts | 50 |
| Activity | Structured events (no message text) | `COORDINATOR_MAX_EVENTS` (30) |
| Messages | Recent room messages (≤ 800 chars each), first names, side | `COORDINATOR_MAX_MESSAGES` (20) |
| Updates | Structured progress updates | `COORDINATOR_MAX_UPDATES` (5) |
| Questions | Answered questions (with answers) and open questions (so they are not repeated) | `COORDINATOR_MAX_ANSWERED_QUESTIONS` (10) |
| Signals and baseline | The deterministic findings and health | — |

**Never included:** emails, phone numbers, user ids, government internal
notes, allocation internal reasons, coordinates, or anything from another
project. The e2e suite asserts this on the payload actually sent.

## 3. Health engine (deterministic first)

`health-engine.ts` is a pure function over a project snapshot. It runs
**live on every page view** and is never cached.

| Signal | When | Severity |
| --- | --- | --- |
| `OVERDUE_TASK` | Open task, due before today | HIGH if high or critical priority, or more than 3 days late; else MEDIUM |
| `BLOCKED_TASK` | Task marked BLOCKED | HIGH at a blocking priority, else MEDIUM |
| `MILESTONE_OVERDUE` | Incomplete milestone past its due date | HIGH |
| `TARGET_DATE_PASSED` | Project target date passed with open tasks | HIGH |
| `DEADLINE_APPROACHING` | Open task due within the window | MEDIUM or LOW |
| `INACTIVITY` | No events, messages or updates for N days (not while PAUSED) | MEDIUM |

The worst matching rule wins:

```
BLOCKED          a BLOCKED task at a blocking priority        (COORDINATOR_BLOCKING_PRIORITIES = HIGH,CRITICAL)
AT_RISK          ≥ N overdue tasks, a missed milestone,
                 or the target date passed with work open      (COORDINATOR_AT_RISK_OVERDUE_TASKS = 2)
NEEDS_ATTENTION  any overdue or blocked task, or inactivity    (COORDINATOR_INACTIVITY_DAYS = 4)
HEALTHY          otherwise
```

Every result carries **reasons in words** ("2 tasks are overdue"; "Milestone
“Repair planning” is past its due date"), built only from the data. A
completed or cancelled project is not evaluated.

**Then the AI.** The model receives the baseline and may judge the project
**worse, never better**: at most one level worse, and only with cited evidence
from messages, updates or events. This is enforced twice:
`validate_insight` in Python, and `parseCoordinatorResponse` in NestJS, which
rejects anything outside the range.

## 4. Outputs

The model must return `CoordinatorModelOutput`: `summary`, `health`,
`health_reason`, `risks[]`, `potential_blockers[]`, `suggestions[]` and
`questions[]`. Enums are controlled:
- **Health:** HEALTHY, NEEDS_ATTENTION, AT_RISK, BLOCKED.
- **Risk type:** OVERDUE_TASK, BLOCKED_TASK, UPCOMING_DEADLINE,
  MISSING_UPDATE, MILESTONE_DELAY, INSUFFICIENT_PROGRESS, REPEATED_BLOCKER,
  OTHER.
- **Severity:** LOW, MEDIUM, HIGH.
- **Question category:** TASK_PROGRESS, BLOCKER, DEADLINE, MILESTONE,
  MISSING_UPDATE, GENERAL.

There is **no reasoning field**: conclusions and evidence only, and no hidden
chain-of-thought is requested or stored.

**Hallucination protection:**
- The prompt forbids inventing completion, deadlines, permits, inspections,
  materials, approvals or commitments, and asks for "This could not be
  determined from the project data" instead.
- **Every finding must cite refs present in the context.** Findings citing
  nothing real are **dropped**, and the count is stored as `droppedItems`.
  This is done in both services.
- A question's `target_ref` must be a real task or milestone.
- Stored refs are **re-resolved on display**. A deleted message or a vanished
  task drops out, so hidden content cannot resurface through an old insight.
- AI risks that only restate a live signal are hidden in favour of the rule.

**What the page shows:**
- **Health** and reasons: live.
- **Rule-based risks and blockers:** live, labelled as such.
- **AI risks:** labelled *AI*.
- **AI blockers:** labelled *AI-detected potential blocker — unconfirmed*.
  Nothing is marked BLOCKED automatically; a person changes a task's status.
- **Suggestions and deadlines.**
- **Source links** on every finding (task, milestone, room message, activity,
  update).

## 5. Persistence, freshness and refresh

**`project_ai_insights`** stores one row per attempt, never overwritten:
- the status, trigger and requester;
- the baseline and final health, and the reason;
- the summary;
- JSON findings and signals;
- `provider`, `modelName`, `modelVersion` and `promptVersion` (for example
  `coordinator-2026-10-v1`), plus `processingMs` and `droppedItems`;
- `basedOnChangeAt`, `generatedAt` and `expiresAt`.

The newest COMPLETED row is shown. A FAILED row records the failure and leaves
it in place.

**Stale** means `expiresAt` has passed (`COORDINATOR_INSIGHT_TTL_HOURS`,
default 24), or the project changed after `basedOnChangeAt`. A change is any
task, milestone or project event, message, update or answer. Stale insights
stay visible with "AI insights may be outdated — refresh", and every insight
shows *Updated N minutes ago*, the model and the prompt version.

**The model is never called on a page view.** It runs only in these cases:

| Trigger | Limits |
| --- | --- |
| **Refresh insights** (any participant) | 5 per user per 10 minutes, and one per project per `COORDINATOR_REFRESH_COOLDOWN_SECONDS` (Redis `SET NX`, default 120 s). The page shows when it is available again |
| **Background check** (`CoordinatorSchedulerService`) | Every `COORDINATOR_SCHEDULE_MINUTES` (120). Up to `COORDINATOR_BATCH_SIZE` (10) live projects whose insight is missing, expired or out of date, and none analysed within `COORDINATOR_MIN_INTERVAL_HOURS` (12). A Redis lock keeps instances from overlapping. Off under test |

Failures — an unavailable provider, malformed output, or health out of range —
record a FAILED insight and return 503 to a manual refresh. Project data is
never touched.

## 6. Questions

**`coordinator_questions`** stores the question, category, target ref, source
refs, status (`OPEN`, `ANSWERED`, `DISMISSED`, `EXPIRED`), answer, who
answered and when, and the expiry.

**Not repeating itself:**
- **Fingerprint:** the category plus the target ref (for example
  `TASK_PROGRESS|task:42`), or the category plus a hash of the normalised text
  when there is no target. Rephrasings about the same task share a
  fingerprint.
- **Partial unique index** `coordinator_questions_one_open`: one OPEN question
  per fingerprint, even under concurrent refreshes.
- **Cool-down:** a fingerprint answered or dismissed within
  `COORDINATOR_QUESTION_COOLDOWN_DAYS` (3) is not asked again.
- **Cap:** at most `COORDINATOR_MAX_OPEN_QUESTIONS` (3) are open at once.
- **Context:** open and answered questions are sent to the model, which is
  told not to repeat them. The AI service also drops near-duplicates by token
  overlap.
- **Expiry:** after `COORDINATOR_QUESTION_EXPIRY_DAYS` (7), or as soon as the
  target task is completed or cancelled.

**Answering:**
- Any participant can answer, with **Yes, completed** or **Not yet** (which
  asks why) or free text.
- The answer is stored under the person who wrote it, and the next analysis
  receives it. The AI never answers or posts as anyone.
- Coordinators (organisation OWNER/ADMIN and the office's officials) can
  dismiss a question.

## 7. Structured updates and AI drafts

**`project_updates`** stores the author, author organisation, `summary`,
`completed[]`, `current[]`, `blockers[]`, `nextSteps[]`, `source` (`MANUAL` or
`AI_ASSISTED`) and `aiModel`.

- **Who posts:** the assigned organisation's members. The government reads.
- **Recorded:** posting records a `PROJECT_UPDATE_POSTED` event.

**Drafting** (`POST …/ai-coordinator/extract-update`):
- The input is a note, or `fromRecentMessages` (the caller's team's room
  messages since the last update).
- It returns a draft with `confidence: null`, because the model reports no
  calibrated confidence, and it **saves nothing**.
- The AI service drops any item that shares no word stem with the source text.
- The UI shows **AI suggested update — Accept, Edit, Dismiss**. Only Accept,
  or Edit then Post, creates the update, in the author's name, marked
  *AI-assisted, confirmed by author*.
- A draft never changes a task, milestone or project status.

## 8. Notifications (quiet by design)

| Type | To | When |
| --- | --- | --- |
| `PROJECT_COORDINATOR_ALERT` | The organisation's OWNER/ADMIN and the office's officials | Health **worsened into** AT_RISK or BLOCKED compared with the previous insight, or a **new** potential blocker appeared. One per insight |
| `PROJECT_COORDINATOR_QUESTION` | Same, plus assignees of the questioned tasks | New questions were created. One per insight, not one per question |

There is nothing for an unchanged refresh, a task update or a message. The
person who requested the refresh is never notified.

## 9. Privacy and security

- Every endpoint resolves access through the project's room. Other
  organisations, other offices, citizens and non-member administrators get
  404.
- Context goes to the provider only from NestJS, through the internal-token
  route, and contains only what §2 lists. Secrets are never in prompts.
- Unknown request fields are rejected on both sides: `extra = forbid` in
  Python and the whitelist pipe in NestJS.
- Insights and questions appear only on the project page, to participants.
  Public pages show nothing from the coordinator.

## 10. Future RAG integration (Prompt 20)

Prompt 20 adds a knowledge layer: civic rules, past projects and documents.
The coordinator will receive retrieved passages as one more context section
with its own refs (`doc:<id>#<chunk>`), cited and validated exactly like tasks
and messages are now. Nothing in this design assumes retrieval exists today.
