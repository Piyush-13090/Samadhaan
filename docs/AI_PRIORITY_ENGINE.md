# AI Priority Engine

Advisory civic prioritisation for government review (Prompt 21). For each
problem under review or being worked on, it estimates how much it deserves
attention first. It explains why, says how much to trust the estimate, and
lets officials override it with a recorded reason.

> **The current priority engine is an explainable heuristic, AI-assisted
> baseline. It is not a clinically, scientifically or governmentally validated
> decision-making model.** It is an advisory tool to order a review queue.
>
> It never allocates, approves, rejects or verifies a problem, never assigns
> an organisation, and never declares a problem resolved. Government officials
> are the decision makers.

---

## 1. Architecture

```
Problem event ─▶ PriorityJobsService (coalesced per problem, idempotent, background)
                   └▶ PriorityCalculationService
                        1. load problem (assessable: SUBMITTED, UNDER_REVIEW, VERIFIED, IN_PROGRESS)
                        2. PriorityFeatureService
                             deterministic: AI analysis · engagement (distinct people) · duplicate
                                            cluster · PostGIS density · local baseline · verification
                                            · photos · recency
                             AI-assisted:   FastAPI POST /priority/features → safety, urgency,
                                            impact breadth, stated affected count (each with
                                            confidence + evidence) — reused while the report is
                                            unchanged
                             guidance:      PUBLIC knowledge passages (RAG), context only
                        3. PriorityModel.score (HeuristicPriorityModel)
                        4. tier · explanation · change summary
                        5. persist (advisory lock; history de-duplicated) · update problems.priorityScore/Tier
                        6. PRIORITY_TIER_CHANGED ─▶ PRIORITY_ESCALATED notification (new CRITICAL only)
Government portal ─▶ queue (sort/filter by effective tier) · PriorityInsightCard · override
```

- **NestJS owns** features, scoring, persistence, access, overrides and the
  audit log.
- **Python owns** one constrained model call that returns *signals*, never a
  score or tier, and a grounding check on that output.
- **The LLM is never asked how important a problem is.** Its signals are
  features, weighted by their confidence, inside a documented formula.

## 2. Features

Each feature is a value from 0 to 1 with a confidence from 0 to 1, or it is
**unavailable**. Every feature also carries a source, its evidence and a note.

| Feature | Weight | Computed from | Confidence |
| --- | --- | --- | --- |
| **Severity** | 20% | Latest completed AI analysis: `severityScore / 10`, or its level (LOW .25 · MEDIUM .5 · HIGH .75 · CRITICAL 1). With no analysis, the recorded level is used | Analysis confidence (+0.1 once verified); 0.3 for a recorded level only |
| **Urgency** | 15% | Analysis urgency level, combined with the AI urgency signal | Each part's own; combined (§4) |
| **Community impact** | 20% | **Distinct people** who supported, followed, commented, independently reported the same issue, or supported those reports, counted once and excluding the reporter. This is taken **relative to the local norm**: the 75th percentile of engagement within 5 km over 180 days, with a floor of 3. `value = 1 − e^(−people / baseline)` | `age / 72 h`, between 0.3 and 1. A new report has had no time to gather support |
| **Safety risk** | 15% | A category prior combined with the AI safety signal. Priors: electricity and public safety 0.8, water 0.6, traffic 0.55, drainage and potholes 0.5, … parks 0.2 | Prior 0.35 (low on purpose); AI signal's own |
| **Geographic impact** | 10% | PostGIS count of *other, unrelated* open problems within 500 m in the last 90 days, excluding duplicates and the cluster, as `1 − e^(−n/3)`, combined with the AI breadth signal | Density 0.6; AI signal's own. Unavailable without a location |
| **Recency** | 5% | `0.5^(days / 14)` since submission | 1 |
| **Affected population** | 10% | **Only a figure stated in the report**, extracted by the AI and checked to appear in the text. Households count as three people; `log₁₀(people + 1) / 4`. Otherwise unavailable ("unknown") | The extraction's own |
| **Evidence** | 5% | 0.4 if verified by an office + 0.25 if it has photos + 0.2 × analysis confidence + 0.15 × min(1, independent reports / 2) | 1 |

These are deliberately **not** inputs:

- **Organisation matching or availability.** "No suitable organisation" never
  lowers priority, because priority measures civic importance, not who can act.
- **Resolution state.** An active project is shown as context ("an
  organisation is working on this") but is not scored.
- **Retrieved guidance** (§9).
- **Reporter identity, language or writing quality.**

**Infrastructure proximity and population data do not exist in Samadhaan.** The
engine says so in the feature's note. It never invents either.

## 3. Score

The scoring model is `HeuristicPriorityModel`, version `priority-heuristic-v1`,
in `apps/api/src/priority/priority-model.ts`.

```
w_i     configured weights, normalised to sum to 1
A       available features (value ≠ null)
e_i  =  w_i × c_i                          for i ∈ A, i ≠ recency      (weight × confidence)
S    =  Σ e_i·v_i / Σ e_i                                           (renormalised over A)
score = 100 × ( (1 − w_r)·S + w_r·v_r )                             (recency never renormalised)

confidence       = Σ_A w_i·c_i / Σ_A w_i
dataCompleteness = Σ_A w_i / Σ_all w_i
```

- **Missing data is excluded, not zeroed.** The other weights are
  renormalised, and the shortfall is reported as `dataCompleteness`.
- **Confidence scales weight.** A signal at 0.2 confidence counts for a fifth
  of its nominal weight, so an uncertain prediction cannot dominate.
- **Recency is capped at its weight.** It adds at most 5 points, however much
  else is missing, so recency alone can never make anything critical.
- **The engagement share is capped** at 1.5× its nominal share after
  renormalisation, and the excess is returned to the other features. Without
  this cap, popularity would dominate when other data is missing.
- **Safety floor.** If safety risk is at least 0.85 with confidence at least
  0.6, and severity is at least 0.75, the tier is at least **High**. The
  explanation says so.

## 4. Combining estimates

When two sources estimate one signal (a prior and an AI signal, or density and
breadth):

```
value = Σ v·c / Σ c        confidence = max(c)
```

A source with null value or zero confidence is ignored.

## 5. Tiers

| Tier | Score (inclusive) | Env |
| --- | --- | --- |
| CRITICAL | ≥ 80 | `PRIORITY_TIER_CRITICAL` |
| HIGH | ≥ 60 | `PRIORITY_TIER_HIGH` |
| MEDIUM | ≥ 35 | `PRIORITY_TIER_MEDIUM` |
| LOW | < 35 | |

**These thresholds, like the weights, are a starting baseline.** They have not
been validated against outcomes. Configuration refuses thresholds that are out
of order.

An assessment is **provisional** when its confidence is below 0.5
(`PRIORITY_PROVISIONAL_CONFIDENCE`) or its data completeness is below 0.6
(`PRIORITY_PROVISIONAL_COMPLETENESS`). The queue and the detail card mark it as
such.

## 6. AI-assisted features

`POST /priority/features` uses prompt `priority-features-2026-10-v1`.

**Input:**

- the report's title, description, category and subcategory;
- the analysis severity, urgency, summary and observations;
- a **coarse locality**: neighbourhood and city only. Address segments with
  digits (house numbers, postcodes) are dropped, and no coordinates are sent.

**Output** is a fixed schema: `safety_risk`, `urgency` and `impact_breadth`,
each `{ value 0–1 | null, confidence, evidence[≤3] }`, plus `stated_affected`.
There is no score, no tier and no reasoning field.

**Validation:**

- *Python:* an evidence phrase is kept only if at least two-thirds of its
  content words occur in the input. A signal left without evidence has its
  confidence halved. A stated count is dropped unless that number appears in
  the input.
- *NestJS:* values are re-checked against their ranges. A response that claims
  no model ran but still carries values is rejected.

**Development provider.** No model runs. Every signal is returned as `null`,
`ai_ran: false`, and the assessment is `aiStatus = UNAVAILABLE`. The safety
category prior still applies, with its low confidence.

**When the AI service fails,** the assessment is still produced from
deterministic features, with `aiStatus = FAILED`, and the next calculation
retries.

**Reuse.** AI features are stored with each assessment and reused while a hash
of their inputs (the report and the analysis id/version) is unchanged, for up
to `PRIORITY_AI_REUSE_DAYS`. Engagement-driven recalculations therefore make no
AI call. `Recalculate` with `refreshAi: true` forces a new call.

**Prompt injection.** The report is in `<report>` tags, which are neutralised
inside the text and marked as data. The prompt also forbids weighing who
reported, wealth, language or engagement.

## 7. Explanations

Reasons are concise and evidence-based. There is never any model reasoning.

- **Drivers.** Up to five features whose value is at least 0.55 (recency at
  least 0.7), ordered by points contributed. Examples: "High severity",
  "Strong safety-risk signal: “live wire in floodwater”", "3 related reports
  from different people", "Recent increase in community support", "Report
  states about 200 households affected", "Verified by a government office".
- **Info.** The safety floor, and resolution context.
- **Warnings.** Every unavailable feature, with why. Plus "Provisional…" when
  confidence or completeness is low.

**History** records changes in words: tier and score movements, any
component that moved by 0.1 or more, and features that became available or
unavailable.

## 8. Persistence, history and recalculation

- **`problem_priority_assessments`** is the history. A new row is written only
  when the *outcome fingerprint* changes: the tier, the score in 2-point steps,
  each component in 0.1 steps, and the scoring and feature versions. Otherwise
  the latest row's `confirmedAt` moves. Daily recency drift and single
  supporters therefore do not create a row each time.
- **`problems.priorityScore`, `priorityTier` and `priorityAssessedAt`** are
  denormalised for the queue. They are written with raw SQL, so the problem's
  `updatedAt`, a real-change signal elsewhere, is untouched.
- **A per-problem advisory lock** (`pg_advisory_xact_lock`) serialises
  calculations across instances.

**Triggers.** Recalculation is never triggered by a page request.

| Event | Delay |
| --- | --- |
| AI analysis completed or failed, review status changed, duplicate confirmed (the original is recalculated) | ~1 s |
| Likely duplicates found; support, follow, comment; allocation accepted, project status changed (context only) | Coalesced per problem over `PRIORITY_DEBOUNCE_SECONDS` (30) |
| Background sweep every `PRIORITY_SCHEDULE_MINUTES` (360), and on start-up | Up to `PRIORITY_BATCH_SIZE` problems with no assessment, one older than `PRIORITY_REFRESH_HOURS`, or one from another scoring or feature version. A Redis lock prevents two instances sweeping at once |

**Jobs are idempotent.** There is one queued job per problem, and a
recalculation that changes nothing only confirms.

## 9. RAG integration

On an assessment whose report changed, up to `PRIORITY_GUIDANCE_TOP_K` (2)
passages are retrieved from **PUBLIC** knowledge only, for the category and
title. They are shown as "Relevant guidance", with links to the exact passage.
On read, each passage is re-checked to still exist and still be PUBLIC.

**Retrieved documents never enter the score and are never sent to the
feature model.** The e2e suite asserts both.

## 10. Government portal

**The review queue:**

- **Sorting.** Priority (the web default) sorts by effective tier, then score,
  then the longest-waiting report; unassessed reports come last and are never
  hidden. The other orders are severity, urgency, newest, oldest and most
  supported.
- **Filtering** by priority: Critical, High, Medium, Low, Not yet assessed.
- **Each card** shows the priority badge (AI estimate, or the official's
  decision marked with a gavel), the score, the top reasons, and the
  confidence and data completeness.
- **Tier headings** group the queue in priority order.

**The problem page** has the `PriorityInsightCard`:

- tier and score;
- why it has this priority;
- confidence and completeness meters;
- the expandable breakdown: each feature with its value, confidence, weight,
  points, source, evidence and notes;
- relevant guidance;
- how the priority changed over time;
- model and versions;
- recalculation, and the override.

## 11. Override

```
POST   /government/:slug/problems/:publicId/priority/override   { tier, reason (10–1000) }
DELETE /government/:slug/problems/:publicId/priority/override   { reason? }
```

- **An override never modifies the AI assessment.** Both are kept and both
  are shown. The effective tier is the override while one exists.
- **What is stored:** `problem_priority_overrides` holds one row per problem,
  with tier, reason, office, official, the time, and the AI tier, score and
  assessment in force at that moment.
- **Audit.** Every change is an append-only audit entry:
  `PRIORITY_OVERRIDE_CREATED`, `_UPDATED` or `_REMOVED`. Its metadata holds
  the user, office, problem, previous and new effective tier, AI tier and
  score, the reason and the timestamp. Entries appear in the office's
  activity feed.
- **Who may override** — the government portal's existing rules, with no new
  roles:
  - platform role GOVERNMENT;
  - an active membership of an operational (not suspended) government office,
    via `GovernmentGuard`;
  - the problem inside that office's jurisdiction (`findInScope`).
- **Who may not:**
  - citizens, organisations and administrators are refused (403);
  - other offices and inactive members get 404, the same answer as for a
    problem that does not exist (IDOR-safe);
  - a suspended office is refused (403).
- **Reason visibility.** The reason is visible to government offices covering
  the problem only, never to citizens or organisations.

## 12. Citizens

`GET /problems/:publicId/priority` follows the problem's own visibility. It
returns only:

- an **attention level** (the effective tier);
- up to three plain reasons from public signals (severity, safety, community,
  geography), with quoted model phrases removed;
- the assessment date.

It does this only once the report is verified. It never returns a score,
confidence figures, an override, or an override's reason.

## 13. Fairness

**Safeguards in place:**

- **Engagement is distinct people, not counts.** Support, follows, comments
  and duplicate reports by the same person count once.
- **Engagement is relative to the area** (75th percentile within 5 km), and
  saturating. Ten supporters in a quiet ward weigh like thirty in a busy one.
- **The engagement share is capped** (§3), and so is recency.
- **Geography is bounded:** a capped density of other open problems, and no
  wealth, land-value or population proxies.
- **The AI is told** not to consider who reported, the neighbourhood's
  wealth, the report's language or quality, or engagement. It never sees
  coordinates.
- **Population figures are never estimated.**

**Known limitations:**

- Areas with less internet access still produce fewer reports and less
  engagement. Normalisation reduces this but cannot remove it.
- The local baseline is computed from counters, which can count one person
  several times, while the numerator uses distinct people. The baseline is
  therefore conservative (high).
- The category safety priors are judgements, not measured rates.
- English-language reports may be read better by the model. Its confidence
  should then be lower, but this has not been measured.

**What to monitor once there is data:**

- the tier distribution by ward and city;
- override rates by area;
- time-to-review by tier.

## 14. ML readiness and training data

**`PriorityModel`** (`name`, `version`, `score(features, config)`) is the seam.
`priorityModelFor(PRIORITY_MODEL)` returns `HeuristicPriorityModel`, the only
implementation. **No trained model exists**, and none is claimed.

**Recorded for future supervised learning:**

- every feature, with value, confidence and source, in `featureMetadata`;
- versions;
- AI inputs hash;
- overrides, with the AI tier and score at the time;
- status history and resolution timestamps (existing).

**Candidate labels and their caveats:**

- **Government overrides are not ground truth.** They reflect an office's
  capacity, politics and knowledge as much as civic need.
- **Resolution time** reflects execution capacity.
- **Confirmed severity, escalations and outcomes** are better candidates but
  sparse.

Any learned model should be evaluated for fairness by area before use, and
must keep human-readable factors alongside its score.

## 15. Configuration

All `PRIORITY_*` variables are listed in `.env.example`:

- **Weights:** `PRIORITY_WEIGHT_*`.
- **Thresholds:** `PRIORITY_TIER_*`, `PRIORITY_PROVISIONAL_*`.
- **Scheduling and debounce:** `PRIORITY_SCHEDULE_MINUTES`,
  `PRIORITY_REFRESH_HOURS`, `PRIORITY_BATCH_SIZE`,
  `PRIORITY_SWEEP_ON_STARTUP`, `PRIORITY_DEBOUNCE_SECONDS`.
- **AI features and reuse:** `PRIORITY_AI_FEATURES_ENABLED`,
  `PRIORITY_AI_REUSE_DAYS`.
- **Radii:** `PRIORITY_NEARBY_RADIUS_M`, `PRIORITY_BASELINE_RADIUS_M`.
- **Recency half-life:** `PRIORITY_RECENCY_HALF_LIFE_DAYS`.
- **Guidance:** `PRIORITY_GUIDANCE_TOP_K`.
- **Kill switch:** `PRIORITY_ENABLED`.

Changing weights takes effect on the next calculation. Bumping
`SCORING_VERSION` or `FEATURE_VERSION` in code makes the sweep reassess
everything.

## 16. Known limitations

- **Not validated.** Weights, thresholds, priors and saturation constants are
  reasoned defaults, not fitted.
- **No population data** and **no infrastructure layer.** Affected population
  is known only when stated.
- **Severity relies on the AI analysis.** Without one, a recorded level is
  used with low confidence.
- **An in-process queue.** Jobs in flight are lost on a crash, and the next
  event or sweep repairs this. The startup and periodic sweeps bound
  staleness to `PRIORITY_REFRESH_HOURS`.
- **Escalation notifications** go to officials of every office whose
  jurisdiction covers the problem, so overlapping jurisdictions are all
  notified.
- **Citizens see the effective tier,** which may be an official's decision.
  They are not told which, by design.
