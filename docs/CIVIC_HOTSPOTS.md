# Civic hotspots and recurring problems

Two deterministic, explainable geographic analyses (Prompt 24). Both are
computed on request, in PostgreSQL and in pure TypeScript. Neither uses a
trained model, a forecast or AI.

## 1. Hotspots — `grid-zscore-v1`

**Question:** where, in this office's jurisdiction and period, is the weighted
density of reports well above the rest of the jurisdiction?

1. **Grid.** Each problem falls in a fixed cell `floor(lng / 0.005)`,
   `floor(lat / 0.005)`, about 0.56 km on a side. The fixed grid makes cell
   ids stable between requests.
2. **Weight.** Each problem contributes:
   - a **severity weight** of LOW 1, MEDIUM 2, HIGH 3, CRITICAL 4;
   - multiplied by a **recency factor** of 0.5^(age in days / 30), where age
     is measured from the end of the period. A report 30 days before the end
     counts half.
3. **Density.** The cell's weight sum ÷ the cell's area in km²
   (`cellAreaKm2`, corrected for latitude).
4. **Normalise.** Compute the z-score of each occupied cell's density against
   the mean and standard deviation of all occupied cells.
5. **A hotspot** has `z ≥ 2` **and** at least 3 problems, **and** the
   jurisdiction has at least 5 occupied cells. Fewer cells give no meaningful
   comparison, so the response carries a note instead.
6. **Confidence** = 1 − e^(−n/5), where n is the cell's problem count. It is a
   measure of evidence, not of probability.

**Output** (`GET /government/:slug/analytics/hotspots`):

- `cells`: every cell with at least 3 problems, as the existing
  `MapAggregateCell` shape. The `CivicMap` adapter draws them unchanged:
  rounded centroid, count, severity counts, top categories.
- `hotspots`: up to 20 scored cells, each with its z-score, density, open
  count, top category and confidence.
- `occupiedCells`, `algorithmVersion` and `note`.

**Properties:**

- **Deterministic:** the same records give the same output, and this is
  unit-tested.
- **Severity and recency** both raise a cell's weight. Volume alone does not
  make a hotspot: a cell must stand out from its surroundings.
- **Privacy:** centroids are averages rounded to 3 decimals, and cells under
  the minimum group size are not returned.

**Persistence.** A `CivicHotspot` table is **not** created. Hotspots depend on
the period, filters and zone chosen, and are cheap to compute for one
jurisdiction. Persisting them would add staleness without a consumer. Add
snapshots only if history of hotspots becomes a requirement.

## 2. Recurring problems — `dbscan-300m-14d-v1`

**Question:** which places keep producing the same kind of problem?

1. Take the period's problems in scope, excluding confirmed `DUPLICATE`s.
2. Per category, cluster with `ST_ClusterDBSCAN(ST_Transform(location, 3857),
   eps = 300, minpoints = 3)`. Web Mercator metres slightly overstate
   distance away from the equator; at Indian latitudes `eps` is about
   265–285 m on the ground.
3. Keep clusters with:
   - at least 3 reports,
   - from at least 2 distinct reporters,
   - whose first and last reports are at least 14 days apart.
4. **Report**, up to 50 clusters: category, the most common postal code or
   city, reports, people, first and last local report dates, span, open
   count, and the rounded centroid.

**Recurring versus duplicate.**

| | Duplicate | Recurring |
| --- | --- | --- |
| What it is | One problem reported twice | The same kind of problem coming back in one place |
| Time | Usually close together | At least 14 days between the first and last report |
| People | Often different reporters of the same event | At least 2 reporters |
| Handling | Merged into the original (Prompt 12) | Shown for attention; nothing is merged or changed |
| Confirmed duplicates | — | Excluded |

Recurrence is an observation for officials. It never triggers an action.

## 3. Limits

- **The grid can split a real cluster** across cell boundaries. Recurring
  detection (density-based) does not have this edge effect.
- **A z-score assumes a comparable population of cells.** A jurisdiction with
  only one dense neighbourhood yields no hotspots by design.
- **Recency is measured from the end of the period,** not from today, so past
  periods are scored on their own terms.
