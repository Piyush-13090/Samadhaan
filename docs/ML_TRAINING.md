# ML Training (Prompt 28)

`python -m ml train` fits a model for one task and writes a verifiable
artifact. It doesn't register or activate anything. Code:
`services/ai/ml/training.py`.

**Status:** no training run has used real data, because none exists yet (see
`ML_CAPABILITY_INVENTORY.md`). The commands below are what to run once a
reviewed dataset is in place. The test suite exercises them on synthetic
fixtures.

## Trainable tasks

| Task | Model | Features | Selection metric | Default split |
| --- | --- | --- | --- | --- |
| `problem_category` | `tfidf-softmax-v1`: TF-IDF words and bigrams → multinomial logistic regression | title + description (`problem-text-v1`) | validation macro-F1 | `group_random` |
| `problem_severity`, `problem_urgency` | same, evaluated ordinally | title + description + category token (`problem-text-category-v1`) | validation macro-F1 | `time` |
| `duplicate_pair` | `signals-logistic-v1`: standardised signals plus missing indicators → logistic regression | the four 0–1 pair signals (`duplicate-signals-v1`) | validation average precision; threshold by `min_precision` | `group_random` |

These are deliberately simple, defensible baselines. A neural model would need
more data, compute and evaluation than exists. Embeddings stay pretrained,
because nothing supports fine-tuning them.

## Commands

```bash
cd services/ai
.venv/bin/python -m ml validate --dataset ml_data/problem-category/2026-10-v1
.venv/bin/python -m ml split    --dataset ml_data/problem-category/2026-10-v1 --config split.json
.venv/bin/python -m ml evaluate --dataset ml_data/problem-category/2026-10-v1 --split test --config split.json
.venv/bin/python -m ml train    --config ml/configs/problem_category.example.json --out run.json
.venv/bin/python -m ml registration --artifact ml_artifacts/problem_category/<version> --out register.json
```

Exit codes: 0 success, 1 invalid or insufficient data (the reasons are printed
as JSON), 2 usage error.

## Configuration

Example configs are in `services/ai/ml/configs/*.example.json`. Relative
dataset paths are resolved against the config file.

| Key | Meaning |
| --- | --- |
| `task`, `dataset`, `artifact_dir`, `version` | `version` defaults to `<task>-<datasetVersion>-<configHash8>`. |
| `split` | `strategy`, `seed`, `validation`, `test`, `holdout_cities`, `min_test_records`, `min_test_per_class`, `min_train_per_class` |
| `model` | Text tasks: `ngram_max`, `min_df`, `max_features`, `class_weight` (`"balanced"` or null), `C_grid`, `max_iter`. Duplicates: `class_weight`, `C_grid`. |
| `decision` | Text tasks: `abstain_below` (confidence), `min_known_ratio` (share of input tokens in the vocabulary), `min_tokens`. Duplicates: `min_precision`. |
| `strict` | Default true: any invalid record stops the run. |
| `allow_synthetic` | Default false. Only for pipeline tests; the registry refuses to promote such models. |
| `min_group_size` | Suppression threshold for group reports. |
| `baseline_threshold` | Threshold for the existing duplicate score (0.65 = "possible duplicate"). |

## What a run does

1. **Validates** the dataset. It refuses:
   - synthetic data, unless `allow_synthetic` is set;
   - a dataset not permitted for training;
   - invalid records, in strict mode.
2. **Splits** with the configured leakage-aware strategy, or stops with
   `INSUFFICIENT_DATA`.
3. **Fits** the vocabulary and IDF, or the standardisation, on the training
   split only.
4. **Selects** C, and the duplicate threshold, on validation. Each candidate's
   validation score is logged.
5. **Exports** the model to JSON, then evaluates *that exported model through
   the serving code* (`app/models/linear.py`) on the test split, **once**.
   Taxonomy labels with no training examples keep their place with a −30
   intercept and are listed as `untrainedLabels`.
6. **Reports** test metrics, baselines, group slices and a reference
   prediction distribution (used by monitoring).
7. **Writes** `ml_artifacts/<task>/<version>/`:
   - `model.json`: canonical JSON;
   - `manifest.json`: provenance, config, metrics, sha256, code revision;
   - `training_log.jsonl`.

   An existing version is never overwritten.

Runs are deterministic: the same dataset and config give byte-identical
`model.json`, which is tested. Class imbalance is handled by
`class_weight: "balanced"` where configured, and its effect shows up in
per-class recall.

## Abstention

Text models return no label, and a reason, when:
- the input has fewer than `min_tokens` tokens (`too_little_text`);
- less than `min_known_ratio` of the tokens are in the vocabulary
  (`out_of_vocabulary`);
- the top probability is below `abstain_below` (`low_confidence`).

An abstention routes the case to a person. It's never turned into a guess.

## Artifacts

- JSON only: weights, vocabulary, IDF and decision thresholds. No pickles, so
  loading an artifact can't execute code.
- The registry stores `<task>/<version>` and the sha256. The AI service
  re-checks both, plus the schema versions, on every load.
- Development artifacts live in `services/ai/ml_artifacts/` (git-ignored). In
  production, point `ML_ARTIFACT_DIR` at a read-only volume or object-store
  mount populated by the release process. Never commit artifacts.

## Test suites

- **Fast** (`pytest`, every run): `test_ml_dataset.py`, `test_ml_splitting.py`,
  `test_ml_metrics.py`, `test_ml_training.py`, `test_ml_serving.py`. All use
  small synthetic fixtures, with no downloads and no network.
- **Optional:** `python -m evaluation.organization_matching` loads the
  sentence-transformers model.
