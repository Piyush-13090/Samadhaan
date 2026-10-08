# Analytics metrics

Every metric the dashboards show, defined once (Prompt 24). The same text
appears as the "?" help beside each metric (`METRIC_DEFINITIONS` in
`packages/shared/src/types/analytics.ts`). Architecture:
[`ANALYTICS_ARCHITECTURE.md`](./ANALYTICS_ARCHITECTURE.md).

## 1. Conventions

- **Cohort.** Unless marked *snapshot* or *event*, a metric covers the
  **problems reported in the period**: `createdAt` in [local midnight of
  `from`, local midnight after `to`) in the reporting zone, not deleted, not
  draft, inside the scope and filters.
- **Verified** means the status is VERIFIED, IN_PROGRESS or RESOLVED, or a
  recorded status change to VERIFIED exists.
- **Open** means SUBMITTED, UNDER_REVIEW, VERIFIED or IN_PROGRESS.
- **Effective priority** is an official's override if one exists, else the AI
  tier, else *Unassessed*.
- **Severity** is the severity recorded on the report.
- **Stage times** come from the audit log (`PROBLEM_STATUS_CHANGED` with
  `metadata.to`) and from the allocation table. A record without them (seeded
  or imported data) is left out of duration metrics; it is never estimated.
- **Durations** are in days: `EXTRACT(EPOCH FROM (b − a)) / 86400`, floored
  at 0. They are rounded to one decimal place for display.

## 2. Thresholds that produce "Not enough data yet"

| Rule | Value | Constant |
| --- | --- | --- |
| A mean, median or fastest duration needs | ≥ 3 observations | `MIN_OBSERVATIONS` |
| A rate needs a denominator | > 0 (organisation rates: ≥ 3) | `ratePct` |
| A % change needs the previous period to have | ≥ 5 | `MIN_COMPARISON_BASE` |
| "Stable" means a change within | ±10 % | `STABLE_BAND_PCT` |
| An area, subcategory or map cell is shown with counts only if it has | ≥ 3 problems | `ANALYTICS_MIN_GROUP_SIZE` |

Below a threshold the value is `null`. The UI shows "Not enough data yet" or
"Comparison unavailable", never 0 and never ∞ %.

## 3. Government command centre

### Overview

| Metric | Formula |
| --- | --- |
| Reported | count(cohort) |
| Verified | count(cohort ∧ verified) |
| In progress | count(cohort ∧ status = IN_PROGRESS) |
| Resolved | count(cohort ∧ status = RESOLVED) |
| Rejected | count(cohort ∧ status = REJECTED) |
| Critical / high priority | count(cohort ∧ effective tier ∈ {CRITICAL, HIGH}) |
| **Resolution rate** | resolved ÷ verified, as %. Unavailable when verified = 0 |
| Avg / median time to verification | mean / median(first VERIFIED change − report), over the cohort's verified rows |
| Avg / median resolution time | mean / median(resolvedAt − report), over the cohort's resolved rows |
| Active now (*snapshot*) | count(open), regardless of period |
| Change | (current − previous) ÷ previous × 100, for counts |

### Trends (*events*)

Per local bucket, events are counted when they happened:

- **reported:** `createdAt`;
- **verified:** the first change to VERIFIED, per problem;
- **rejected:** the first change to REJECTED, per problem;
- **resolved:** `resolvedAt`.

### Categories

| Field | Definition |
| --- | --- |
| Share | category count ÷ cohort count × 100 |
| Change and direction | `changePct` against the previous period. Above +10 %: increasing; below −10 %: decreasing; otherwise stable. Unknown when the previous count is under 5 |
| Persistent | reported in at least 75 % of the period's buckets (with at least 4 buckets) |
| Subcategories | free-text groups, case-insensitive, shown only with 3 or more; top 15 |
| Severity / priority distribution | counts per level or tier |

### Areas

- **Groups:** by state, city and postal code (normalised), with count, open
  and resolved; top 50 each.
- **Suppression:** groups with fewer than 3 show their name only.
- **Jurisdiction total:** the office's whole area, for context.

### Resolution

| Metric | Definition |
| --- | --- |
| Avg / median / fastest | report → resolution, over the cohort's resolved rows (needs 3) |
| Longest waiting (*snapshot*) | max(now − report) over open problems matching the filters |
| Resolution rate | as in the overview |
| Resolutions returned | verification requests to this office decided REJECTED or MORE_EVIDENCE_REQUESTED in the period |

**Funnel.** Counts are cumulative: a later stage implies the earlier ones, so
the funnel never widens.

- **resolved:** status RESOLVED.
- **in progress:** resolved, or status IN_PROGRESS, or a recorded change to
  IN_PROGRESS.
- **allocated:** in progress, or any allocation exists.
- **verified:** allocated, or verified.
- **under review:** verified, or a recorded change to UNDER_REVIEW, or status
  UNDER_REVIEW or REJECTED.
- **submitted:** the cohort.
- **Conversion** = stage ÷ previous stage × 100.

**Stage durations.** Each needs 3 observations.

| Stage | From → to |
| --- | --- |
| Report → review started | report → first UNDER_REVIEW |
| Review → verified | first UNDER_REVIEW (or the report) → first VERIFIED |
| Verified → allocated | first VERIFIED → first allocation proposed |
| Allocated → accepted | first proposed → first accepted |
| Accepted → resolved | first accepted → `resolvedAt` (resolved only) |

**Bottleneck.** The stage with the longest average, among at least two
measured stages. Worded as *where time is spent*, never *why*.

**Time-to-resolution distribution.** Buckets of < 1, 1–3, 3–7, 7–14, 14–30
and 30+ days; lower bound inclusive.

**By priority / by severity.** Per group: count, resolved, resolution rate
(resolved ÷ verified), median days (needs 3), and open now. The UI notes that
differences between groups are observations, not causes.

### Community (Prompt 23 data)

| Metric | Definition |
| --- | --- |
| Active contributors | distinct users with ledger rows for problems in scope, awarded in the period |
| Impact points earned | Σ positive amounts, excluding administrator adjustments |
| Contributions to resolution | ledger rows of resolution types (`RESOLUTION_TYPES`) |
| Verified reports / confirmed duplicates | cohort counts |
| Community-supported | cohort rows with at least 1 supporter |
| Report → verification; verification → resolution | means over the cohort (need 3) |

No one is named.

## 4. Organisation (own work only, never ranked)

| Metric | Definition |
| --- | --- |
| Problems accepted | allocations to the organisation accepted in the period |
| Active projects (*snapshot*) | PLANNED, ACTIVE or PAUSED |
| Projects completed | completed in the period |
| Average project duration | mean(start or creation → completion), needs 3 |
| On-time completion | of completed projects with a target date, those completed on or before it (local date); needs 3 |
| Tasks completed / open tasks | completed in the period / open on live projects now (workload) |
| Evidence submitted | submitted in the period |
| Evidence approval rate | approved ÷ (approved + rejected), decided in the period; needs 3 |
| Resolutions approved | verification requests approved in the period |

## 5. Citizen (own reports, all time)

- **Counts:** reported, verified, in progress, awaiting review, resolved,
  confirmed duplicates.
- **Median report → resolution** over their resolved reports (any number).
- **Supporters:** the total across their reports.
- **Impact points:** from `user_impact_stats`.

## 6. Privacy rules

- **Minimum group size of 3** for areas, subcategories, hotspot cells and
  recurring clusters.
- **Coordinates** are rounded to 3 decimals and only appear as cell or
  cluster centroids. No exact report location leaves the analytics API.
- **No personal data in aggregates.** No names or user ids. The community
  section counts people and never lists them.
