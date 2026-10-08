# Reputation system

Reputation, tiers and badges (Prompt 23). Points: [`IMPACT_POINTS.md`](./IMPACT_POINTS.md).

> **Reputation is an initial heuristic of contribution quality.** It is not a
> scientifically validated measure of trustworthiness, and nothing in
> Samadhaan makes an automatic decision about a person from it. It does not
> rank, restrict or penalise anyone.

---

## 1. Points versus reputation

| Measure | What it is |
| --- | --- |
| **Impact points** | The *quantity* of recognised contribution: a sum of the ledger |
| **Reputation (0–100)** | The *quality and reliability* of contribution |

A user with many rejected reports should not outrank one with fewer,
reliable ones, so reputation weighs rates rather than volume.

## 2. Calculation — `REPUTATION_V1`

`ReputationService` and `reputationScore` in `impact-rules.ts`:

```
score = 100 × ( 0.40 × report accuracy
              + 0.20 × evidence acceptance
              + 0.20 × successful outcomes
              + 0.20 × sustained participation )

report accuracy        = (verified + 0.6·3) / (verified + rejected + 3)     Beta prior: 0.6, 3 observations
evidence acceptance    = (approved + 0.6·2) / (approved + rejected + 2)     Beta prior: 0.6, 2 observations
successful outcomes    = 1 − e^(−resolved contributions / 5)
sustained participation = min(1, active months in the last 12 / 6)
```

**Inputs:**

- **Reports:** "verified" means the report reached VERIFIED, IN_PROGRESS or
  RESOLVED; "rejected" means the government rejected it. Duplicates count as
  neither.
- **Evidence:** submitted completion evidence that the government approved or
  rejected.
- **Active months:** months with a positive ledger award, excluding
  adjustments.

**Properties:**

- **A new account starts in the middle** (about 36), not at zero and not at
  the top.
- **No single event swings the score much.** The priors keep one verified or
  rejected report within a few points; this is tested.
- **Quantity enters only through saturating terms.** Many rejected reports
  *lower* the score.

**When it is recomputed:** after any award to the user, after a rejected
report, and after rejected evidence. Recomputation uses bounded per-user
counts. The score is stored in `user_impact_stats` with `reputationVersion`.

## 3. Tiers

A tier needs **both** points and a minimum reputation, so volume alone cannot
reach the top. The thresholds are configurable (`TIERS`) and are not
validated.

| Tier | Points | Minimum reputation |
| --- | --- | --- |
| New Contributor | 0 | — |
| Active Contributor | 100 | — |
| Trusted Contributor | 300 | 55 |
| Civic Champion | 700 | 65 |
| Civic Leader | 1500 | 75 |

Reaching a higher tier sends one notification. A tier can also go down if
reputation drops below its minimum; that is never announced.

## 4. What is shown

`GET /users/me/reputation` and the profile show:

- the score;
- the tier and what the next one needs;
- verified reports;
- successful contributions;
- resolved civic issues;
- the note that this is a heuristic.

**Never shown:** rejected reports, rejected evidence, or any other negative
signal. Those are inputs, not labels.

## 5. Badges

Definitions are in code (`BADGES`) and are upserted into `badge_definitions`
on start-up. `user_badges` is append-only and unique per user and badge.

| Badge | Earned by |
| --- | --- |
| First Report | 1 verified report |
| Community Helper | 3 community awards (early comment or support on resolved problems) |
| Duplicate Detector | 3 confirmed duplicates |
| Civic Contributor | 100 impact points |
| Project Contributor | 3 credited project contributions |
| Resolution Champion | 5 resolved contributions |
| Civic Champion | The Civic Champion tier |

**Evaluation** (`BadgeEvaluationService`) runs for one user after their
awards: one grouped count over that user's ledger, never a scan of everyone.
Each new badge sends one notification. **No endpoint can grant a badge.**

## 6. Fairness

- **Engagement is not rewarded for its own sake.**
- **Quality is shown beside quantity** on the leaderboard and in tiers.
- **Free time still helps.** Someone with more time can contribute more;
  per-period and per-city views and the reputation column soften this, but do
  not remove it.
- **Reputation depends on government decisions** (verification, rejection,
  approval), so it inherits any bias in those decisions. Rejection rates by
  area should be monitored before reputation is ever used for anything
  consequential. Today it is used for nothing consequential.

## 7. Not built (by design)

Reputation is never used for:

- automatic decisions;
- restricting accounts;
- AI-generated scoring;
- organisation or government scorecards;
- financial rewards.
