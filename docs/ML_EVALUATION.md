# ML Evaluation (Prompt 28)

How Samadhaan measures model quality, and every measurement that has actually
been taken. Code: `services/ai/ml/metrics.py` and `ml/evaluate.py`. Each metric
is computed from real predictions against real held-out labels, and is tested
against hand-computed examples and scikit-learn (`tests/test_ml_metrics.py`).

## Measured, synthetic and not measured

| Kind | Meaning |
| --- | --- |
| **Measured** | A number computed in this repository from recorded predictions and labels. Its dataset is stated. |
| **Synthetic test result** | Output on generated fixtures. It proves the pipeline works and says nothing about real accuracy. Such numbers aren't reported as accuracy anywhere. |
| **Not measured** | No suitable labels exist. It says so instead of giving a number. |

## Results to date

| Capability | Result | Dataset | Kind |
| --- | --- | --- | --- |
| Organisation matching (`heuristic-baseline@1.0.0`) | mean P@1 **1.00**, mean NDCG@3 **0.97** | `evaluation/organization_matching_dev.json`: 6 problems × 8 organisations, hand-written by developers (Prompt 14) | Measured on a tiny development set. It shows rankings behave sensibly; it is **not** evidence of real-world accuracy. |
| Priority heuristic (`priority-heuristic-v1`) | Sensitivity to ±25% on any one weight: Spearman ≥ **0.9925**, tier agreement ≥ **95.8%**, top-decile overlap ≥ **92.5%**. Safety floor fired in 9 of 2,000 cases. Mean score with missing features 50.5 vs 50.2 complete. | 2,000 seeded synthetic feature vectors (`apps/api/scripts/ml/results/priority-sensitivity.json`) | Behaviour of the heuristic, **not** accuracy: no adjudicated priority labels exist. |
| Problem category, severity, urgency | — | — | **Not measured.** No reviewed labels (`ML_CAPABILITY_INVENTORY.md`). |
| Duplicate detection | — | Reviewed-pair export: 0 records in dev DB | **Not measured.** |
| Resolution verification | — | 0 government decisions in dev DB | **Not measured.** |
| Search and RAG retrieval | — | No relevance judgements | **Not measured.** |
| Training pipeline | Runs end to end. Artifacts verify. Retraining is reproducible (identical sha256). Selection never reads the test split. | Synthetic fixtures (`tests/test_ml_training.py`) | Synthetic test result. |

Reproduce:

```bash
cd services/ai && .venv/bin/python -m evaluation.organization_matching
cd apps/api && npm run build && node scripts/ml/priority-sensitivity.mjs --n=2000 --seed=28
```

## Metric definitions

### Classification (category)

- **Per-class** precision, recall, F1 and support. **Macro-F1** averages over
  classes present in the truth, so a rare category counts as much as a common
  one. Weighted-F1 and accuracy are also reported.
- **Confusion matrix:** rows are truth, columns are prediction, in taxonomy
  order.
- **Imbalance:** classes present and absent, and the max:min support ratio.
- **Abstentions** (`None`) count against recall but not precision. They're
  reported as `coverage`: an abstention sends the case to a person, it isn't an
  error.

### Severity and urgency (ordinal)

Everything above, plus:
- **mean absolute error** in levels;
- **within-one-level** accuracy;
- **quadratic weighted kappa**;
- **most severe class:** support, recall, and the count under-predicted or
  abstained. Under-calling CRITICAL is the costly error, so it's reported on
  its own.

### Duplicate detection (binary)

- Precision, recall and F1 at the decision threshold, with TP/FP/FN/TN.
- **Average precision**: step-wise area under the precision-recall curve,
  checked against scikit-learn.
- A down-sampled **PR curve**.
- The ids of **false positives** and **false negatives**, for review.

The training threshold is the highest-F1 threshold whose validation precision
meets `min_precision` (example config: 0.95). A wrong merge erases a citizen's
distinct report.

### Ranking (organisation matching, retrieval, priority)

- Mean **precision@K**, **recall@K**, **MRR** and **NDCG@K** over queries.
  NDCG uses graded gain `2^rel − 1`.
- Queries with no relevant item are excluded from recall and MRR, and counted.
- For organisation matching, **exposure by organisation size** compares the
  share of top-3 slots with the share of relevant judgements, per size. A gap
  toward large organisations is the bias to watch.

### Resolution verification

- Per-class metrics over RESOLVED / NOT_RESOLVED / INSUFFICIENT_EVIDENCE.
- The **false-resolution rate**: P(predicted RESOLVED | truly not resolved).
- **Insufficient-evidence** precision and recall, reported separately.

The existing system's recommendation maps to outcomes conservatively:
- `LIKELY_RESOLVED` → RESOLVED;
- `LIKELY_NOT_RESOLVED` → NOT_RESOLVED;
- `POSSIBLY_RESOLVED` and `INSUFFICIENT_EVIDENCE` → INSUFFICIENT_EVIDENCE.

### Priority

With expert-adjudicated tiers (`priority_judgement`), the evaluation gives:
- Spearman correlation between the engine score and the expert tier;
- ranking metrics with HIGH/CRITICAL as relevant.

Without them, only sensitivity analysis is valid.

### Groups and fairness

`slice_report` gives macro-F1 and accuracy per group (city, category).
Groups under `min_group_size` (default 30) are **suppressed**: they're neither
named nor scored, because small groups are unreliable and can identify people.
Training manifests include city slices, and category slices for severity and
urgency.

## Baseline before training

```bash
cd services/ai
# the existing system on all reviewed records
.venv/bin/python -m ml evaluate --dataset ml_data/<name>/<version>
# the existing system on exactly the held-out split a model will be tested on
.venv/bin/python -m ml evaluate --dataset ml_data/<name>/<version> --split test --config split.json
```

Training also reports two baselines on the test split:
- the majority class;
- when the dataset has `baseline_<label>` columns, the existing system, both on
  its covered subset and alongside the model on the same subset.

## Rules

- Metrics come from predictions on held-out records, never constants. No
  success percentage is hardcoded anywhere.
- The test split is used once, after model and threshold selection on
  validation.
- AI outputs and heuristic scores are never ground truth.
- When there's too little data, the result is `INSUFFICIENT_DATA` with
  reasons, never a number.
