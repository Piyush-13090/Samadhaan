# Model Monitoring (Prompt 28)

Code: `apps/api/src/ml/model-monitoring.service.ts`, `model-monitoring.ts`.
Report: `GET /api/v1/admin/ml/monitoring?task=<TASK>&days=<1–90>` (ADMIN).

## What's recorded

Every registry inference attempt writes one `model_inferences` row with these
fields only:

| Field | Note |
| --- | --- |
| `task`, `modelVersionId` | The model version that was asked. |
| `outcome` | `OK`, `ABSTAINED`, `INPUT_SCHEMA`, `ARTIFACT_ERROR`, `TIMEOUT` or `ERROR`. |
| `latencyMs` | Time for the whole call, as the API saw it. |
| `predictedLabel`, `confidence`, `abstainReason` | Null on failure. |
| `missingFeatures` | A count, not names of values. |
| `inputLength` | A bucket (`0-49`, `50-199`, `200-499`, `500-999`, `1000+`). |

There's no input text, problem id, user id or location: a row can't be linked
back to a report or a person. Rows are deleted after
`ML_MONITORING_RETENTION_DAYS` (default 90) by an hourly prune. The AI service
logs task, version, outcome and latency, never inputs (tested).

## The report

For each model version in the window, the report gives:
- **total** and **outcomes**;
- **failure rate**: ERROR + TIMEOUT + ARTIFACT_ERROR;
- **fallback rate**: everything except OK and ABSTAINED. The caller then used
  the existing path;
- **input-schema failures**, **abstention rate** and **missing-feature rate**;
- **latency** p50 and p95;
- the **prediction distribution**, **confidence histogram** (tenths) and
  **input-length distribution**.

It also has:
- `configurationChanges`: activations, rollbacks and deactivations of the task
  in the window, from the audit log;
- `labelledPerformance`: currently always `{ available: false, reason }`.

## Four different things

| Signal | Measured by | What it can tell you |
| --- | --- | --- |
| **Data drift** | PSI of input-length buckets, last window vs the window before, same version | The inputs changed shape. |
| **Prediction drift** | PSI of predicted labels, last window vs the window before, same version; and vs the **reference** distribution of the training run's test predictions | The model is answering differently. |
| **Performance degradation** | Only by comparing predictions with authorised human labels collected afterwards | Whether it's *wrong*. **Not measured live today** (see below). |
| **Configuration change** | Audit log of activation, rollback and deactivation | A shift caused by swapping models, not by the world. |

Drift is computed **per model version**, so a version change never shows up as
drift.

**A distribution shift isn't an accuracy drop**, and the report says so. A
shift above `ML_DRIFT_PSI_WARN` (default 0.2, the conventional "significant"
PSI) produces a warning to investigate. With fewer than
`ML_MONITORING_MIN_SAMPLES` (default 100) on either side, a check is
`not_assessable` instead of showing a number.

PSI = Σ (q − p) · ln(q / p) over categories, with ε = 1e-4 smoothing. It's 0
for identical distributions and unit-tested against a hand computation.

## Delayed, labelled evaluation

Accuracy needs labels that arrive after the prediction from an authorised
human process:
- duplicate decisions (`CONFIRMED_DUPLICATE` / `NOT_DUPLICATE` with a
  reviewer);
- government verification decisions;
- for category, severity and urgency, a review workflow that doesn't exist
  yet.

Today's procedure:

1. Export reviewed records, pseudonymised, for example
   `scripts/ml/export-duplicate-labels.sh`.
2. Run `python -m ml evaluate` (existing system) and compare it with the
   active model's held-out metrics in the registry.
3. Record the result with `POST /admin/ml/models/:id/evaluation` against the
   new evaluation dataset version.

Live joining of predictions to later labels isn't implemented. Monitoring rows
deliberately can't be joined back to problems, and no label source exists for
the analysis tasks. Linking them would need a reviewed design for how
predictions and labels meet without retaining identifiers.

## Fairness and reliability safeguards

| Risk | Safeguard |
| --- | --- |
| Geographic or socioeconomic gaps | City slices in every training manifest; a geographic-holdout split to test unseen places. Groups under 30 are suppressed. |
| Rare but severe problems | Macro-F1 (not accuracy). Most-severe-class recall and under-prediction reported separately. `class_weight: balanced` available. |
| Class imbalance | Imbalance ratio and absent classes reported. Untrained taxonomy labels listed and never predicted. |
| Low confidence, poor input, missing description | Abstention (`low_confidence`, `out_of_vocabulary`, `too_little_text`) routes to a person. Missing features are counted. |
| False duplicate matches | Precision-first threshold (`min_precision`). False-positive ids listed. Duplicates only ever confirmed by a person. |
| Organisation matching favouring large organisations | Exposure-by-size report in organisation-relevance evaluation. Matching remains a recommendation. |
| False "resolved" claims | False-resolution rate reported on its own. No trained verification model. Government decision required. |
| Sensitive attributes | Not features: datasets refuse identity, contact and location fields. Text identifiers are redacted. Civic importance never uses reporter identity, popularity or affiliation. |
