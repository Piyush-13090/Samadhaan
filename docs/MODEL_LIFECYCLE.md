# Model Lifecycle (Prompt 28)

```
python -m ml train ──> register ──> EXPERIMENTAL ──record evaluation──> EVALUATED
                                                                         │ approve (another admin)
                                                                         ▼
          RETIRED <──retire── (any state but ACTIVE)                  APPROVED ──activate──> ACTIVE
                                                                         ▲                    │
                                                                         └── replaced, rolled back, deactivated
```

## Rules (enforced by the server)

| Step | Requires | Refused when |
| --- | --- | --- |
| Register | ADMIN. Schema versions match the task. Canonical `artifactUri`. Training metrics with a held-out test result. | Any mismatch (400); duplicate version (409). |
| Record evaluation | ADMIN. EXPERIMENTAL or EVALUATED. Not synthetic. `metrics` with `n > 0` and an `evaluationDatasetVersion`. | Synthetic data or no measurement. |
| Approve | ADMIN **other than the registrant**. EVALUATED. Not synthetic. A note. | Same admin (403); not evaluated (409). |
| Activate | ADMIN. APPROVED, evaluated, approved, not synthetic. **A fresh AI-service check** that the artifact exists, matches its sha256 and has compatible schemas (`POST /models/verify`). A reason. | Any failed check. The refusal is audited as `MODEL_ACTIVATION_REFUSED`. |
| Roll back | ADMIN. A rollback target that's still APPROVED, re-verified. | No target, target retired, or the pointer changed concurrently. |
| Deactivate | ADMIN. An active model. | Nothing active. |
| Retire | ADMIN. Not ACTIVE. | Active (deactivate or roll back first). |

- **Nothing is automatic.** A new registration, a better score or a finished
  run never activates or replaces anything.
- **One active version per task.** Activation demotes the current version to
  APPROVED and records it as the rollback target. Rollback swaps the two.
  Deactivation keeps the last version as the target. Retiring a target clears
  it.
- **Concurrency.** Each lifecycle transaction takes a per-task advisory lock.
  Each transition is a conditional update (`WHERE status IN (...)`), so a lost
  race is a 409, never a double activation.
- **Audit.** Each change writes `audit_logs` with the actor, the task, the
  versions involved and the reason, in the same transaction.
- **Least privilege.** Citizens, organisation members and government officials
  get 403 on every `/admin/ml` route (e2e-tested).

## Serving

Registry inference runs only when **both** of these are true:

1. `ML_INFERENCE_ENABLED=true` in the API (default **false**); and
2. the task has an ACTIVE, non-synthetic version.

When both hold, after a problem's provider analysis completes and is stored,
`ModelInferenceService.annotateAnalysis` asks the AI service for category,
severity and urgency predictions from the exact approved artifact (task,
version, sha256). It stores them under the analysis's
`rawResult.mlPredictions`, marked `advisory: true`.

Neither the analysis's own fields nor the problem itself are changed. The
provider result stays primary, and government review stays authoritative.
`rawResult` isn't published to clients.

`DUPLICATE_PAIR` models can be registered, evaluated and activated, but aren't
wired into duplicate detection. Using one there would be a separate decision,
made with evaluation evidence.

Fallbacks: any of the following returns `null`, and the existing behaviour
continues unchanged. Each is recorded as a monitoring outcome.

| Failure | Recorded as |
| --- | --- |
| No active model, or inference disabled | (no call made) |
| Timeout (`ML_INFERENCE_TIMEOUT_MS`, default 3 s) | `TIMEOUT` |
| Artifact missing, corrupt or incompatible | `ARTIFACT_ERROR` |
| Input outside the task schema | `INPUT_SCHEMA` |
| Output outside the task's labels or 0–1 confidence (validated by the API) | `ERROR` |
| Model abstained | `ABSTAINED`: stored as advisory "needs a human", with no label |

The active version is cached per process for `ML_ACTIVE_CACHE_SECONDS`
(default 30). Activation invalidates the cache in the process that did it;
other replicas pick up the change within the TTL.

Rate limits and authorisation are unchanged: inference is server-side only,
on the internal token.

## Sensitive tasks

Severity, urgency and duplicate predictions are always advisory. Resolution
verification has no trained-model task at all: the government decision is the
only path to "resolved".

## Configuration

| Variable | Service | Default |
| --- | --- | --- |
| `ML_INFERENCE_ENABLED` | API | `false` |
| `ML_INFERENCE_TIMEOUT_MS` | API | `3000` |
| `ML_ACTIVE_CACHE_SECONDS` | API | `30` (0 in tests) |
| `ML_MONITORING_RETENTION_DAYS` | API | `90` |
| `ML_DRIFT_PSI_WARN` | API | `0.2` |
| `ML_MONITORING_MIN_SAMPLES` | API | `100` |
| `ML_ARTIFACT_DIR` | AI service | `./ml_artifacts` |

## Runbook: a bad model is active

1. `POST /admin/ml/tasks/:task/rollback` restores the previous approved
   version, re-verified; or
2. `POST /admin/ml/tasks/:task/deactivate` falls back to the provider alone;
   or
3. set `ML_INFERENCE_ENABLED=false` to turn off all registry inference at
   once.

All three only affect advisory annotations: no problem data needs repair.
