# Model Registry (Prompt 28)

The registry is PostgreSQL tables owned by the NestJS API. Artifacts are stored
on disk under the AI service; the registry only references them. Migration:
`20261018090000_model_registry`. Code: `apps/api/src/ml/`.

## Tables

### `model_versions`

One row per trained model. `(task, version)` is unique.

| Column | Meaning |
| --- | --- |
| `task` | `PROBLEM_CATEGORY`, `PROBLEM_SEVERITY`, `PROBLEM_URGENCY` or `DUPLICATE_PAIR` (mirrors `services/ai/app/models/tasks.py`). |
| `version`, `status` | Status is EXPERIMENTAL, EVALUATED, APPROVED, ACTIVE or RETIRED. |
| `modelFormat` | `tfidf-softmax-v1` or `signals-logistic-v1`. |
| `artifactUri`, `artifactSha256` | Always `<task>/<version>` under `ML_ARTIFACT_DIR` (CHECK constraint), plus the sha256 of `model.json`. Client-chosen paths aren't accepted. |
| `featureSchemaVersion`, `labelSchemaVersion` | Must match the task's supported versions. |
| `datasetName`, `datasetVersion`, `datasetFingerprint` | Training data provenance. |
| `syntheticData` | A CHECK constraint keeps synthetic-data models in EXPERIMENTAL or RETIRED. |
| `trainingConfig`, `codeRevision`, `trainedAt` | From the training manifest. |
| `trainingMetrics` | The run's own measurements: selection, held-out test, baselines, slices, reference distribution. |
| `evaluationDatasetVersion`, `evaluationMetrics`, `evaluatedAt`, `evaluatedById` | The recorded evaluation. |
| `registeredById`, `approvedById`, `approvedAt`, `approvalNote` | Who did what. A CHECK constraint stops the approver being the registrant. |
| `activatedAt`, `retiredAt` | Lifecycle timestamps. |

### `active_models`

One row per task. `modelVersionId` is the serving version; null means the task
is switched off. `previousModelVersionId` is the rollback target. The row also
records who changed it, when, and why.

### `model_inferences`

Monitoring rows: task, version, outcome, latency, predicted label, confidence,
abstention reason, missing-feature count and input-length bucket. **No text,
problem id or user id.** Rows are pruned after
`ML_MONITORING_RETENTION_DAYS`.

### Database guarantees

The application enforces these rules too; the database enforces them for
every writer:
- the sha256 is hex and the version name is safe;
- the artifact URI is canonical;
- synthetic-data models stay EXPERIMENTAL;
- APPROVED and ACTIVE rows have both an approver and an evaluation;
- the approver isn't the registrant;
- confidence is between 0 and 1;
- at most one ACTIVE version per task (partial unique index
  `model_versions_one_active_per_task`, in `prisma/sql/post-migrate.sql`).

## API (platform ADMIN only)

Base path: `/api/v1/admin/ml`. Rate limit: 60 requests/min per admin. Every
state change writes `audit_logs` (entity `ModelVersion`) in the same
transaction.

| Method and path | Action |
| --- | --- |
| `GET /models[?task=]`, `GET /models/:id` | List and read. |
| `POST /models` | Register. Body from `python -m ml registration`. |
| `POST /models/:id/evaluation` | Record an evaluation: `{ evaluationDatasetVersion, metrics }`. |
| `POST /models/:id/approve` | Approve: `{ note }`. |
| `POST /models/:id/activate` | Activate: `{ reason }`. |
| `POST /models/:id/retire` | Retire: `{ reason }`. |
| `GET /tasks` | Active version and rollback target for each task. |
| `POST /tasks/:task/rollback` | Roll back: `{ reason }`. |
| `POST /tasks/:task/deactivate` | Switch the task off: `{ reason }`. |
| `GET /monitoring?task=&days=` | Monitoring report (`MODEL_MONITORING.md`). |

Audit actions:
- `MODEL_REGISTERED`
- `MODEL_EVALUATION_RECORDED`
- `MODEL_APPROVED`
- `MODEL_ACTIVATED`
- `MODEL_ACTIVATION_REFUSED`
- `MODEL_ROLLED_BACK`
- `MODEL_DEACTIVATED`
- `MODEL_RETIRED`

## Registering a run

```bash
cd services/ai
.venv/bin/python -m ml registration --artifact ml_artifacts/problem_category/<version> --out register.json
# then, as an administrator (session cookie from /auth/login):
curl -X POST https://<api>/api/v1/admin/ml/models -H 'content-type: application/json' \
  -b cookies.txt -d @register.json
```

Registration is refused:
- with 400, when schema versions mismatch, the URI isn't canonical, or the
  metrics have no held-out test result (`test.n > 0`);
- with 409, for a duplicate version.

The registry stores what the training run measured; it never computes or
rewrites metrics. A row can't claim a run or an evaluation that didn't happen.
Without measured metrics a model can't be registered, and without a recorded
evaluation it can't be approved.

## Artifact storage

Artifacts never go into PostgreSQL or Git. `ML_ARTIFACT_DIR` (AI service,
default `./ml_artifacts`) must hold `<task>/<version>/model.json` and
`manifest.json`. In production, mount it read-only from the release process.
The AI service refuses an artifact when:
- the name is unsafe or the path escapes the directory;
- `model.json` doesn't match the manifest's sha256 or the registered sha256;
- the task or schema versions are unsupported;
- the model document is malformed.

The error codes are `ARTIFACT_INVALID_NAME`, `ARTIFACT_NOT_FOUND`,
`ARTIFACT_INTEGRITY`, `ARTIFACT_INCOMPATIBLE` and `ARTIFACT_CORRUPT`.
