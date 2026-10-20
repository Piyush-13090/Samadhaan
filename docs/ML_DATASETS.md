# ML Datasets (Prompt 28)

How labelled data enters the ML pipeline, what it must look like, and the
privacy rules it must follow. Code: `services/ai/ml/` (`schemas.py`,
`dataset.py`, `privacy.py`, `splitting.py`).

## Layout

A dataset is a directory, versioned by name and never edited in place:

```
services/ai/ml_data/<name>/<version>/      (git-ignored)
  dataset.json      provenance (required)
  records.jsonl     or records.csv
```

Neither datasets nor artifacts are committed (`.gitignore`:
`services/ai/ml_data/`, `services/ai/ml_artifacts/`). Test fixtures are
generated synthetically in `services/ai/tests/ml_fixtures.py`.

### `dataset.json`

| Field | Rule |
| --- | --- |
| `name`, `version` | Safe identifiers. A version is immutable: a change means a new version. |
| `task` | One of the schemas below. |
| `records_file` | `*.jsonl` or `*.csv` in the same directory. |
| `description`, `owner`, `collection` | Required provenance: what it is, who owns it, how records and labels were collected and reviewed. |
| `permitted_uses` | `training` and/or `evaluation`. Training refuses a dataset without `training`. |
| `retention` | Retention and deletion expectations. |
| `consent_basis` | Why this use of the data is permitted. |
| `contains_personal_data` | Must be `false`; `true` is refused (pseudonymise first). |
| `synthetic` | `true` for generated data. Synthetic-data models can never be promoted. |
| `created_at` | ISO timestamp. |

## Schemas, one per task

Every record has `record_id`, `label_source`, optional `created_at` (stored as
UTC) and optional `city`. Unknown fields are rejected (`extra="forbid"`).

**Labels must be independent human judgement.** `label_source` must be one of
`HUMAN_REVIEWED`, `EXPERT_ADJUDICATED` or `GOVERNMENT_DECISION`. Datasets that
use `AI_GENERATED`, `MODEL_OUTPUT`, `HEURISTIC`, `CITIZEN_SELF_REPORTED` or
`UNKNOWN` as a label are rejected with that reason. The existing system's
outputs may appear in a dataset only as **baseline** columns to be evaluated.

| Task | Fields (besides the common ones) | Label |
| --- | --- | --- |
| `problem_category` | `title`, `description`, `incident_id?`, `subcategory?` (free text, normalised; there's no closed list), `baseline_category?` | `category`, in the taxonomy |
| `problem_severity` | `title`, `description`, `category?`, `incident_id?`, `baseline_severity?` | `severity` LOW–CRITICAL |
| `problem_urgency` | as above, with `urgency` / `baseline_urgency` | `urgency` LOW–CRITICAL |
| `duplicate_pair` | `problem_a`, `problem_b` (pseudonymous), 0–1 `text_similarity`, `geographic_similarity`, `category_similarity`, `image_similarity`, `baseline_score?` | `is_duplicate` |
| `organization_relevance` | `query_id`, `organization_id`, `system_score?`, `organization_size?` | `relevance` 0–3 (graded) |
| `verification_outcome` | `evidence_id`, `project_id?`, `system_recommendation?` | `outcome`: RESOLVED / NOT_RESOLVED / INSUFFICIENT_EVIDENCE |
| `retrieval_judgement` | `query_id`, `document_id`, `system_score?` | `relevance` 0–3 |
| `priority_judgement` | `problem_id`, `engine_score?` | `expert_tier` |

Taxonomy values come from `services/ai/app/core/taxonomy.py`, which mirrors
the Prisma enums. Labels must be canonical; aliases aren't silently mapped.

## Validation

```bash
cd services/ai
.venv/bin/python -m ml validate --dataset ml_data/duplicate-pairs/2026-10-v1 --out report.json
```

The report includes:
- total and valid record counts;
- invalid records, each with every failing field and its reason;
- duplicate `record_id`s (all copies invalid) and groups of identical text;
- missing values per field;
- label distribution and redaction counts;
- the **fingerprint**.

The command exits with code 1 if any record is invalid.

The fingerprint is a SHA-256 over the preprocessing version, the task and the
canonical JSON of the valid, preprocessed records sorted by `record_id`. The
same inputs always give the same fingerprint; any change gives a new one.
Record order and source format (CSV or JSONL) don't change it.

## Preprocessing

Preprocessing is deterministic and versioned (`preprocess-v1`):
- NFKC normalisation;
- whitespace collapsing;
- identifier redaction in `title`/`description`;
- UTC timestamps.

Model features also lower-case text, build words and bigrams, and redact again
at serving time with the same function (`app/models/privacy.py`). Training and
serving therefore can't drift apart.

## Splits and leakage

`ml/splitting.py` assigns **groups**, never single records. Records are in the
same group if they share:
- an `incident_id`;
- identical text;
- for duplicate pairs, any problem connected through any pair (union-find);
- a `query_id`, `project_id` or `problem_id` (ranking and evidence tasks).

| Strategy | Use |
| --- | --- |
| `group_random` | Keyed hash of (seed, group): deterministic, and stable as data grows. |
| `time` | Oldest groups train, newest test. Use it for future-facing predictions (severity, urgency, priority). |
| `geographic` | `holdout_cities` form the test set, to measure generalisation to unseen places. |

Split reports record the strategy, seed, ratios and group and record counts
per split, plus labels per split. The run stops with the reasons listed if a
split is too small, as `INSUFFICIENT_DATA` (exit code 1). It doesn't train on
what's there.

## Privacy

- **Columns:** a dataset contains only its schema's fields. Fields that are
  personal or confidential by name are refused outright:
  - email, phone, names;
  - reporter, user and author ids;
  - IP address and user agent;
  - passwords and tokens;
  - latitude, longitude and address;
  - internal notes, resolution messages, and private or restricted documents.

  The full list is `FORBIDDEN_FIELDS` in `ml/privacy.py`.
- **Text:** emails, URLs, phone numbers and Aadhaar/PAN-style numbers are
  replaced with `[EMAIL]`, `[URL]`, `[PHONE]` and `[ID_NUMBER]`. This is a
  safety net, not anonymisation.
- **Confidential content** (private government notes, resolution-room
  messages, restricted knowledge documents) needs an explicit, authorised,
  documented purpose and access policy before any export. No exporter for
  these exists.
- **Citizen reports are not unrestricted public data.** Exports are
  pseudonymised and minimised. A dataset's retention entry must say how
  deletion requests reach it. A deleted problem means re-exporting a new
  dataset version.

## Exporting reviewed duplicates

```bash
cd apps/api
ML_EXPORT_SALT=<secret, 32+ chars> scripts/ml/export-duplicate-labels.sh 2026-10-v1
# optional second argument: reviewer roles, default GOVERNMENT,ADMIN
```

The export holds only reviewed pairs (`CONFIRMED_DUPLICATE` = true,
`NOT_DUPLICATE` = false, with a reviewer recorded). Each record has the stored
signals, the existing `combinedScore` as the baseline, the review date and the
city. Problem ids are salted-SHA-256 pseudonyms; the salt is a secret kept
outside the dataset. There's no text, coordinates or identities.

By default only decisions by officials and admins are exported. A reporter
confirming their own report isn't an independent label.

On the development database, this export produced **0 records** (2026-10-18).

## Ownership

The Samadhaan platform team owns exported datasets. Store them only where the
production database's access policy applies. Review them yearly, and delete
them along with their source decisions.
