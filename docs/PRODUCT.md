# Samadhaan — Product

> **Status:** Foundation milestone. This document describes the product being
> built. See [Implementation status](#implementation-status) for what exists today.

## What Samadhaan is

Samadhaan is an AI-powered civic problem reporting, collaboration and resolution
platform.

A citizen photographs a real-world problem — a broken streetlight, an overflowing
drain, an unsafe crossing. Samadhaan turns that photo into a structured,
categorised, prioritised piece of work; connects it to the organisations able to
act on it; and tracks it through to a verified resolution.

The problem it addresses is not that citizens cannot complain. It is that
complaints do not become **tracked work with an accountable owner**. Reports
arrive as unstructured text across disconnected channels, duplicates multiply,
severity is assessed inconsistently, and nobody can see whether anything happened.

Samadhaan's answer:

1. **Structure at intake.** AI reads the photo and the description, so the
   citizen does not have to categorise anything correctly.
2. **Deduplication.** Ten reports of one pothole become one problem with ten
   supporters — a signal of severity, not ten tickets.
3. **Matching.** Organisations discover problems suited to their capability and
   geography, rather than waiting to be assigned.
4. **Verified closure.** A problem closes on evidence that has been checked, not
   on an assertion that it was fixed.

## Target users

| User | What they need |
| --- | --- |
| **Citizens** | Report a problem in under a minute and see that it went somewhere |
| **NGOs** | Find problems matching their mission, capacity and area |
| **Universities** | Source real civic problems for student and research projects |
| **Industries** | Direct CSR budgets at problems with measurable, verified impact |
| **Government** | Triage by real severity, allocate to capable partners, evidence outcomes |
| **Admins** | Verify organisations, moderate content, keep the platform trustworthy |

## Roles

Six roles, modelled as `UserRole` in the database:

- `CITIZEN` — reports problems, supports, comments, suggests solutions
- `NGO` — discovers problems, proposes to take them on, reports progress
- `UNIVERSITY` — as NGO, oriented toward research and student projects
- `INDUSTRY` — as NGO, oriented toward CSR funding and execution
- `GOVERNMENT` — reviews, allocates, and makes the final resolution decision
- `ADMIN` — platform operations, organisation verification, moderation

`NGO`, `UNIVERSITY` and `INDUSTRY` share the organisation workflow and differ in
discovery, reporting emphasis and verification requirements.

## Core workflow

```
Citizen sees a problem
   └─> photographs it, describes it, tags the location
          └─> AI analyses image + text
                 ├─ categorises the problem
                 ├─ estimates severity and urgency
                 └─ detects potential duplicates
                        └─> Community supports, comments, suggests solutions
                               └─> NGOs / Universities / Industries discover it
                                      └─> Government reviews and allocates
                                             └─> Resolution Room opens
                                                    └─> Organisations collaborate
                                                           └─> AI Coordinator requests progress
                                                                  └─> AI extracts structured updates
                                                                         └─> Organisation submits evidence
                                                                                └─> AI assists verification
                                                                                       └─> Government decides
                                                                                              └─> RESOLVED
                                                                                                     └─> Impact Points, leaderboard, analytics
```

Two properties matter throughout:

- **AI assists, humans decide.** AI categorises, scores, flags duplicates and
  reviews evidence. A government reviewer makes the allocation and closure
  decisions. AI output is always a recommendation with its confidence attached.
- **Every state change is attributable.** Who changed what, when, and on what
  evidence — because the output is a public record of civic accountability.

## Main product features

**Reporting** — photo capture, description, automatic and manual geotagging,
offline-tolerant submission.

**AI understanding** — category, severity, urgency, duplicate candidates, and
structured attributes extracted from the image and text.

**Community** — support (upvote), threaded comments, proposed solutions with
endorsement. Duplicate reports merge into supporter counts.

**Organisation discovery** — filtered feeds by category, geography, severity and
capability; expressions of interest.

**Government workspace** — triage queue ordered by predicted priority, allocation
to verified organisations, final resolution decisions.

**Resolution Rooms** — a shared workspace per allocated problem, holding
participants, milestones, progress updates and evidence.

**AI Project Coordinator** — prompts organisations for progress on schedule and
converts free-text replies into structured milestone updates.

**Evidence verification** — completion evidence checked against the original
report (location, subject, plausibility) before a human approves closure.

**Impact** — Impact Points for contributors, leaderboards, and analytics on
resolution rates by category and area.

## Long-term vision

Samadhaan should become the **civic problem record** for the areas it serves: the
place where a problem is registered, where its history lives, and where its
resolution is evidenced.

Three directions beyond the core workflow:

1. **From reactive to predictive.** With enough resolved history, predict where
   problems will recur and which interventions actually hold.
2. **Public accountability data.** Aggregate resolution performance by area and
   category, as a public dataset.
3. **Integration over replacement.** Municipal systems already exist. Samadhaan
   should feed them structured, deduplicated, prioritised work rather than
   demand they be replaced.

## Implementation status

Nothing in the workflow above is implemented yet. The foundation milestone
delivers the architecture that the features are built on:

| Area | Status |
| --- | --- |
| Repository, build, tooling | Implemented |
| Next.js / NestJS / FastAPI services | Implemented (health endpoints only) |
| PostgreSQL + PostGIS + pgvector | Implemented |
| Redis connection | Implemented |
| `User` model with roles | Implemented |
| Everything else above | Not started |

See [`DATABASE.md`](./DATABASE.md), [`API.md`](./API.md) and [`ML_PLAN.md`](./ML_PLAN.md)
for the per-area breakdown.
