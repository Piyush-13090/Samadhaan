# Analytics architecture

Civic analytics, intelligence and impact dashboards (Prompt 24). Metric
definitions are in [`ANALYTICS_METRICS.md`](./ANALYTICS_METRICS.md);
hotspots and recurring problems are in
[`CIVIC_HOTSPOTS.md`](./CIVIC_HOTSPOTS.md).

> Every number comes from the platform's real records. Where the data cannot
> support a number, the API returns `null` and the UI says **"Not enough data
> yet"** or **"Comparison unavailable"**. Nothing is padded, sampled or
> invented.

---

## 1. Pipeline

```
operational tables ─▶ query layer ─▶ aggregation ─▶ scoped API ─▶ dashboards
 problems, audit_logs   filterSql      PostgreSQL     Government /   Next.js
 problem_allocations    timeline CTE   GROUP BY,      organisation / (client
 resolution_*           EFFECTIVE_TIER percentile_    citizen        sections)
 impact_point_*         bucketSql      cont, FILTER   controllers
                                        │
                                        ▼
                         pure rules (analytics-metrics.ts):
                         rates, change, funnel, suppression, hotspots
```

- **No new tables, no materialised views.** Everything is indexed SQL over
  existing tables, computed per request and cached briefly (§5).
- **No migration.** Existing indexes are enough:
  - `problems (status, createdAt)` and `(state, city, status)`;
  - `audit_logs (entityType, entityId, createdAt)`;
  - `problem_allocations (problemId, createdAt)`;
  - the GiST index on `problems.location`.

## 2. Modules

| File (`apps/api/src/analytics/`) | Role |
| --- | --- |
| `analytics-time.ts` | Periods, IANA zone validation, local-day bucketing, the true-instant correction |
| `analytics-sql.ts` | `filterSql`, `EFFECTIVE_TIER`, the `timeline` CTE, duration helpers |
| `analytics-metrics.ts` | Pure rules: `ratePct`, `changePct`, `direction`, `funnel`, `bottleneck`, `suppress`, `scoreHotspots`, CSV |
| `government-analytics.service.ts` | Overview, trends, categories, areas, resolution, community, hotspots, recurring, export rows |
| `organization-analytics.service.ts` | An organisation's own delivery; a citizen's own figures |
| `analytics-insights.service.ts` | Facts → AI summary, with public RAG guidance kept separate |
| `analytics-export.service.ts` | CSV/JSON exports, audited |
| `analytics-cache.service.ts` | Redis cache keyed by scope |
| `analytics.controller.ts` | Three controllers: government, organisation, citizen |

Python: `services/ai/app/{schemas/insights.py, prompts/analytics_insights.py,
services/insights_service.py, api/routes/insights.py}`.

Web: `apps/web/src/components/analytics/*` and the pages
`/government/[slug]/analytics`, `/organization/[slug]/analytics` and
`/impact`.

## 3. Time

- **The period.** It is chosen as local dates in a reporting time zone:
  - `timezone` must be an IANA zone; the default is `ANALYTICS_TIMEZONE`
    (Asia/Kolkata).
  - Presets: `7d`, `30d`, `90d`, `6m` (182 days), `1y` (365 days).
  - Custom ranges: `from`/`to`, validated as real dates, `from ≤ to`, not in
    the future, at most 731 days.
- **Instants.** Node converts local midnight to UTC instants (`zonedMidnight`,
  DST-safe). SQL compares columns with those instants as bound parameters.
- **Granularity.** Up to 31 days: day. Up to 184: week, starting Monday.
  Longer: month. Every bucket is returned, so quiet buckets show 0.
- **Previous period.** The same length, ending where the current one starts.
- **The day-boundary bug is fixed.** Grouping by
  `col AT TIME ZONE 'UTC'` put a report filed at 01:00 in Kolkata on the
  previous day. Buckets now use the local date in the reporting zone. The
  command-centre dashboard trend uses the same helper. A regression test
  files a report at 01:00 IST and checks it lands on the right day in both
  zones.
- **The true-instant correction.**
  - Timestamps written through Prisma are interpreted in the database
    session's zone. On a non-UTC session they are stored shifted.
  - Comparisons with Prisma Date parameters shift identically, so they stay
    correct.
  - For grouping, `trueInstant(col)` =
    `(col AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC'`
    undoes the shift. It is the identity on a UTC session, so it stays correct
    once the database runs in UTC.
  - Durations (one column minus another) are exact either way.
  - The impact ledger now writes `createdAt` from a Date parameter (it used
    `now()`), so ledger time windows are consistent with every other table.

## 4. Authorisation and scope

| Surface | Gate | Scope inside every query |
| --- | --- | --- |
| `GET /government/:slug/analytics/*` | `@Roles('GOVERNMENT')` and `GovernmentGuard` (active membership of an operational office) | `scope.jurisdiction.condition` |
| `GET /organizations/:slug/analytics` | `OrganizationWorkspaceGuard` (active member) | `assignedOrganizationId` / `organizationId` = the organisation |
| `GET /users/me/analytics` | Signed in | `reporterId` = the session user |

- **Filters only narrow.** Category, severity, status, priority, city and
  postal code are ANDed with the jurisdiction predicate and never replace it.
- **Unknown query parameters are rejected** (`forbidNonWhitelisted`).
- **Non-members get 404**, including other offices' officials and government
  officials asking for an organisation's analytics.
- **Privacy:**
  - Small groups are suppressed (§6 of the metrics doc).
  - Hotspot and recurring centroids are rounded to 3 decimals (about 100 m)
    and need at least 3 problems.
  - The problem export has no coordinates, reporters, notes or allocation
    reasons.
  - Insights send the model computed facts only.

## 5. Caching

- **What is cached.** Government sections are cached in Redis for
  `ANALYTICS_CACHE_SECONDS` (default 120). Organisation analytics are cached
  the same way. Citizen analytics are not cached.
- **The key** is a SHA-256 of:
  - the scope kind and organisation id;
  - a hash of the jurisdiction predicate (its SQL and values);
  - the endpoint;
  - the resolved period (dates, zone, granularity);
  - every filter.
- **No cross-scope reuse.** Two offices, two jurisdictions or two time zones
  never share an entry. A preset's dates are part of the key, so entries roll
  over at local midnight.
- **Insights** are cached for `ANALYTICS_INSIGHT_CACHE_HOURS` (6) under the
  same scope key. `GET …/insights` returns the cached one or `null`.
- **Failures and tests.** A Redis failure only means the query runs. Caching
  is off under `NODE_ENV=test`.

## 6. AI insights and RAG

- **Generation is on request only:** `POST …/insights`, rate-limited to 10 per
  hour per user. The flow:
  1. Overview, categories and resolution are computed.
  2. `buildFacts` formats them into at most 60 labelled facts. Unavailable
     values are omitted, not described. Deterministic signals (increase,
     decrease, bottleneck, attention) are attached by rule.
  3. **RAG (reference knowledge only).** PUBLIC knowledge is retrieved for the
     category that increased (or the largest one). Up to two passages are
     sent as `G1`/`G2`.
  4. The AI service returns a summary, observations and attention items, each
     citing fact keys, plus guidance notes citing refs. Its prompt forbids new
     numbers, causes, forecasts, recommendations and blame.
- **Validation runs twice.**
  - Python drops any statement that cites unknown facts, uses numbers that
    are not in the facts (rounding allowed), or states a cause.
  - NestJS re-filters the keys and refs.
- **Separation in the response and the UI:**
  - Observed data: `facts`.
  - AI interpretation: `summary`, `observations`, `attention`.
  - Reference knowledge: `guidance`, `guidanceNotes`.
- **The development provider runs no model.** It returns the facts listed
  verbatim, marked `aiRan: false` ("No model ran").
- **Nothing is decided.** Nothing triggers an action, and nothing is
  forecast.

## 7. Exports

`GET /government/:slug/analytics/export?dataset=…&format=csv|json` plus the
dashboard's period and filters.

- **Datasets:** `overview`, `trends`, `categories`, `areas`, `resolution`,
  `problems`.
- **`problems`** carries public fields only: public id, title, category,
  severity, status, effective priority, city, state, postal code, local
  report and resolution dates, supporter count. It is capped at
  `ANALYTICS_EXPORT_MAX_ROWS` (5000), and the JSON says `truncated`.
- **CSV safety:** every cell is quoted, and values beginning `=`, `+`, `-`,
  `@`, tab or CR are prefixed with `'` so spreadsheets do not evaluate them.
- **Rate limit:** 30 per hour per user.
- **Audit:** every export writes `ANALYTICS_EXPORTED` (dataset, format, rows,
  period, filters).
- **Response handling:** `StreamableFile` responses bypass the JSON envelope
  (`ResponseInterceptor`).

## 8. Performance strategy

- **One query per section,** most with `count(*) FILTER (…)` over a single
  scan of the jurisdiction's problems in range.
- **Stage times use `LEFT JOIN LATERAL` lookups** on indexed audit and
  allocation rows for the period's problems only.
- **Sections load independently in the browser.** A slow or failed section
  does not block the others (the partial state).
- **When to add materialised snapshots:** only when measured latency demands
  it. The likely first candidates are daily per-office category and status
  counts. Prompt 27 owns scalability work.

## 9. Not built (by design)

- Advanced search (Prompt 25).
- Forecasting or trained forecasting models.
- Autonomous or automatic government actions.
- Financial analytics.
- Organisation ranking or comparison.
- Security hardening (Prompt 26) and the scalability overhaul (Prompt 27).
