"""Controlled training (Prompt 28).

    python -m ml train --config ml/configs/problem_category.example.json

One entry point, `train(config)`, for the tasks in `app/models/tasks.py`:

1. load and validate the dataset (strict by default: any invalid record stops
   the run, with the validation report saved for review);
2. split with the configured leakage-aware strategy;
3. fit features on the training split only;
4. select hyperparameters on the validation split;
5. export the chosen model to JSON and evaluate *that exported model* through
   the serving code on the test split — once — alongside simple baselines and
   the existing system's outputs when the dataset carries them;
6. write the artifact (model.json + manifest.json with provenance, config,
   metrics and the sha256) and a structured training log.

Nothing is registered or activated here: registration is a separate,
authenticated API call (docs/MODEL_LIFECYCLE.md).
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression

from app.models.artifacts import canonical_json, write_artifact
from app.models.linear import (
    SIGNALS_FORMAT,
    TEXT_FORMAT,
    SignalsLogisticModel,
    TextSoftmaxModel,
)
from app.models.tasks import DUPLICATE_SIGNALS, TASKS
from app.models.text_features import fit_tfidf, problem_text, transform_many
from ml.dataset import Dataset, DatasetError, load_dataset
from ml.metrics import binary_report, classification_report, ordinal_report, slice_report
from ml.splitting import Split, SplitConfig, split_dataset

#: Intercept given to a taxonomy label with no training examples, so the
#: exported model still has the full label set but never predicts it.
UNTRAINED_INTERCEPT = -30.0


class TrainingError(Exception):
    pass


@dataclass
class TrainingConfig:
    task: str
    dataset: str
    artifact_dir: str = "ml_artifacts"
    version: str | None = None
    split: dict[str, Any] = field(default_factory=dict)
    model: dict[str, Any] = field(default_factory=dict)
    decision: dict[str, Any] = field(default_factory=dict)
    strict: bool = True
    allow_synthetic: bool = False
    min_group_size: int = 30
    baseline_threshold: float = 0.65

    @classmethod
    def from_file(cls, path: Path | str) -> TrainingConfig:
        data = json.loads(Path(path).read_text())
        unknown = set(data) - set(cls.__dataclass_fields__)
        if unknown:
            raise TrainingError(f"unknown config keys: {sorted(unknown)}")
        config = cls(**data)
        base = Path(path).parent
        # Relative paths in a config file are relative to the file.
        if not Path(config.dataset).is_absolute():
            config.dataset = str((base / config.dataset).resolve())
        return config

    def fingerprint(self) -> str:
        body = {k: v for k, v in self.__dict__.items() if k not in {"artifact_dir", "dataset"}}
        return hashlib.sha256(canonical_json(body)).hexdigest()


class TrainingLog:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def event(self, step: str, **data: Any) -> None:
        self.events.append({"step": step, **data})

    def write(self, path: Path) -> None:
        path.write_text("".join(json.dumps(e, sort_keys=True) + "\n" for e in self.events))


def _code_revision() -> dict[str, Any] | None:
    try:
        rev = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True, timeout=5
        ).stdout.strip()
        dirty = bool(
            subprocess.run(
                ["git", "status", "--porcelain"], capture_output=True, text=True, timeout=5
            ).stdout.strip()
        )
        return {"commit": rev, "dirty": dirty}
    except (OSError, subprocess.SubprocessError):
        return None


def _version(config: TrainingConfig, dataset: Dataset) -> str:
    if config.version:
        return config.version
    raw = f"{config.task}-{dataset.manifest.version}-{config.fingerprint()[:8]}"
    return re.sub(r"[^a-z0-9._-]+", "-", raw.lower().replace("_", "-"))


def _check_dataset(config: TrainingConfig, dataset: Dataset, log: TrainingLog) -> None:
    if dataset.task != config.task:
        raise TrainingError(f"dataset task {dataset.task} does not match config task {config.task}")
    if "training" not in dataset.manifest.permitted_uses:
        raise TrainingError("dataset manifest does not permit training")
    if dataset.manifest.synthetic and not config.allow_synthetic:
        raise TrainingError("dataset is synthetic; set allow_synthetic only for pipeline tests")
    if dataset.report.invalid and config.strict:
        raise TrainingError(
            f"{len(dataset.report.invalid)} invalid records (see the validation report); "
            "fix them or set strict=false to train on the valid subset"
        )
    log.event("dataset", **dataset.report.to_json(), fingerprint=dataset.fingerprint)


# ---------------------------------------------------------------- text tasks


def _texts(task: str, records: list[dict[str, Any]]) -> list[str]:
    uses_category = TASKS[task].feature_schema == "problem-text-category-v1"
    return [
        problem_text(r["title"], r["description"], r.get("category") if uses_category else None)
        for r in records
    ]


def _csr(vectors, width: int) -> csr_matrix:
    data, indices, indptr = [], [], [0]
    for v in vectors:
        indices.extend(v.indices)
        data.extend(v.values)
        indptr.append(len(indices))
    return csr_matrix((data, indices, indptr), shape=(len(vectors), width), dtype=np.float64)


def _train_text(
    config: TrainingConfig, dataset: Dataset, split: Split, log: TrainingLog
) -> tuple[dict[str, Any], dict[str, Any]]:
    spec = TASKS[config.task]
    label = dataset.label_field
    m = config.model
    state = fit_tfidf(
        _texts(config.task, split.train),
        min_df=int(m.get("min_df", 2)),
        max_features=int(m.get("max_features", 20000)),
        ngram_max=int(m.get("ngram_max", 2)),
    )
    width = len(state.vocabulary)
    if width == 0:
        raise TrainingError("vocabulary is empty after min_df filtering")
    x_train = _csr(transform_many(state, _texts(config.task, split.train)), width)
    x_val = _csr(transform_many(state, _texts(config.task, split.validation)), width)
    y_train = [r[label] for r in split.train]
    y_val = [r[label] for r in split.validation]
    log.event("features", vocabulary=width, train=len(y_train), validation=len(y_val))

    best: tuple[float, float, LogisticRegression] | None = None
    for c in sorted(float(v) for v in m.get("C_grid", [0.25, 1.0, 4.0])):
        clf = LogisticRegression(
            C=c,
            class_weight=m.get("class_weight"),
            max_iter=int(m.get("max_iter", 2000)),
            random_state=0,
        )
        clf.fit(x_train, y_train)
        score = classification_report(y_val, list(clf.predict(x_val)), spec.labels)["macroF1"]
        log.event("selection", C=c, validationMacroF1=score)
        if best is None or score > best[0]:
            best = (score, c, clf)
    assert best is not None
    _, chosen_c, clf = best
    log.event("selected", C=chosen_c, validationMacroF1=best[0])

    classes = [str(c) for c in clf.classes_]
    coef = clf.coef_ if len(classes) > 2 else np.vstack([-clf.coef_[0] / 2, clf.coef_[0] / 2])
    intercept = (
        clf.intercept_
        if len(classes) > 2
        else np.array([-clf.intercept_[0] / 2, clf.intercept_[0] / 2])
    )
    weights = np.zeros((len(spec.labels), width))
    bias = np.full(len(spec.labels), UNTRAINED_INTERCEPT)
    for i, cls in enumerate(classes):
        j = spec.labels.index(cls)
        weights[j] = coef[i]
        bias[j] = intercept[i]
    decision = {
        "abstain_below": float(config.decision.get("abstain_below", 0.0)),
        "min_known_ratio": float(config.decision.get("min_known_ratio", 0.0)),
        "min_tokens": int(config.decision.get("min_tokens", 1)),
    }
    document = {
        "format": TEXT_FORMAT,
        "labels": list(spec.labels),
        "features": state.to_json(),
        "weights": weights.tolist(),
        "intercept": bias.tolist(),
        "uses_category": spec.feature_schema == "problem-text-category-v1",
        "decision": decision,
    }
    serving = TextSoftmaxModel(json.loads(canonical_json(document)))

    def predict(records):
        return [
            serving.predict(
                {
                    "title": r["title"],
                    "description": r["description"],
                    "category": r.get("category"),
                }
            )
            for r in records
        ]

    test_pred = predict(split.test)
    y_test = [r[label] for r in split.test]
    labels_pred = [p.label for p in test_pred]
    report_fn = (
        ordinal_report if spec.kind == "ordinal_text_classification" else classification_report
    )
    test = report_fn(y_test, labels_pred, spec.labels)

    majority = Counter(y_train).most_common(1)[0][0]
    baselines: dict[str, Any] = {
        "majorityClass": {
            "label": majority,
            **report_fn(y_test, [majority] * len(y_test), spec.labels),
        }
    }
    column = f"baseline_{label}"
    with_baseline = [r for r in split.test if r.get(column)]
    if with_baseline:
        baselines["existingSystem"] = {
            "column": column,
            "coverage": round(len(with_baseline) / len(split.test), 6),
            **report_fn(
                [r[label] for r in with_baseline], [r[column] for r in with_baseline], spec.labels
            ),
        }
        model_same_subset = [
            p.label for r, p in zip(split.test, test_pred, strict=True) if r.get(column)
        ]
        baselines["modelOnExistingSystemSubset"] = report_fn(
            [r[label] for r in with_baseline], model_same_subset, spec.labels
        )

    slices = {
        "city": slice_report(
            [r.get("city") for r in split.test],
            y_test,
            labels_pred,
            spec.labels,
            config.min_group_size,
        )
    }
    if config.task != "problem_category":
        slices["category"] = slice_report(
            [r.get("category") for r in split.test],
            y_test,
            labels_pred,
            spec.labels,
            config.min_group_size,
        )
    reference = Counter(p.label or "ABSTAINED" for p in test_pred)
    confidences = [p.confidence for p in test_pred]
    metrics = {
        "selection": {"metric": "validationMacroF1", "value": best[0], "C": chosen_c},
        "test": test,
        "baselines": baselines,
        "slices": slices,
        "reference": {
            "predictionDistribution": dict(sorted(reference.items())),
            "confidenceHistogram": _histogram(confidences),
        },
        "untrainedLabels": [x for x in spec.labels if x not in classes],
    }
    return document, metrics


def _histogram(values: list[float], bins: int = 10) -> list[int]:
    counts = [0] * bins
    for v in values:
        counts[min(bins - 1, int(v * bins))] += 1
    return counts


# ---------------------------------------------------------------- duplicate pairs


def _signal_matrix(records: list[dict[str, Any]]) -> np.ndarray:
    rows = []
    for r in records:
        values = [r.get(s) for s in DUPLICATE_SIGNALS]
        rows.append(
            [v if v is not None else 0.0 for v in values] + [float(v is None) for v in values]
        )
    return np.asarray(rows, dtype=np.float64)


def _train_duplicates(
    config: TrainingConfig, dataset: Dataset, split: Split, log: TrainingLog
) -> tuple[dict[str, Any], dict[str, Any]]:
    x_train = _signal_matrix(split.train)
    mean = x_train.mean(axis=0)
    scale = x_train.std(axis=0)
    scale[scale == 0] = 1.0
    y_train = [bool(r["is_duplicate"]) for r in split.train]
    y_val = [bool(r["is_duplicate"]) for r in split.validation]
    if len(set(y_train)) < 2:
        raise TrainingError("training split needs both duplicate and non-duplicate pairs")
    norm = lambda x: (x - mean) / scale  # noqa: E731
    best = None
    from ml.metrics import average_precision

    for c in sorted(float(v) for v in config.model.get("C_grid", [0.1, 1.0, 10.0])):
        clf = LogisticRegression(
            C=c, class_weight=config.model.get("class_weight"), max_iter=2000, random_state=0
        )
        clf.fit(norm(x_train), y_train)
        scores = clf.predict_proba(norm(_signal_matrix(split.validation)))[:, 1]
        ap = average_precision(y_val, list(scores))
        log.event("selection", C=c, validationAveragePrecision=round(ap, 6))
        if best is None or ap > best[0]:
            best = (ap, c, clf, scores)
    assert best is not None
    ap, chosen_c, clf, val_scores = best

    # Threshold on validation: the highest F1 whose precision meets the floor.
    # A wrong merge erases a citizen's distinct report, so precision comes first.
    floor = float(config.decision.get("min_precision", 0.9))
    candidates = []
    for th in sorted(set(round(float(s), 4) for s in val_scores)):
        r = binary_report(y_val, list(val_scores), th)
        if r["precision"] >= floor and r["tp"] > 0:
            candidates.append((r["f1"], th))
    threshold = max(candidates)[1] if candidates else 1.0
    log.event("threshold", threshold=threshold, minPrecision=floor, feasible=bool(candidates))

    document = {
        "format": SIGNALS_FORMAT,
        "signals": list(DUPLICATE_SIGNALS),
        "mean": mean.tolist(),
        "scale": scale.tolist(),
        "coef": clf.coef_[0].tolist(),
        "intercept": float(clf.intercept_[0]),
        "decision": {"threshold": threshold},
    }
    serving = SignalsLogisticModel(json.loads(canonical_json(document)))
    y_test = [bool(r["is_duplicate"]) for r in split.test]
    test_scores = [
        serving.predict({s: r.get(s) for s in DUPLICATE_SIGNALS}).probabilities["DUPLICATE"]
        for r in split.test
    ]
    ids = [r["record_id"] for r in split.test]
    metrics: dict[str, Any] = {
        "selection": {"metric": "validationAveragePrecision", "value": round(ap, 6), "C": chosen_c},
        "test": binary_report(y_test, test_scores, threshold, ids),
        "baselines": {},
        "reference": {
            "predictionDistribution": dict(
                sorted(
                    Counter(
                        "DUPLICATE" if s >= threshold else "NOT_DUPLICATE" for s in test_scores
                    ).items()
                )
            ),
            "confidenceHistogram": _histogram(test_scores),
        },
    }
    with_baseline = [r for r in split.test if r.get("baseline_score") is not None]
    if with_baseline:
        metrics["baselines"]["existingCombinedScore"] = {
            "coverage": round(len(with_baseline) / len(split.test), 6),
            **binary_report(
                [bool(r["is_duplicate"]) for r in with_baseline],
                [float(r["baseline_score"]) for r in with_baseline],
                config.baseline_threshold,
                [r["record_id"] for r in with_baseline],
            ),
        }
    return document, metrics


# ---------------------------------------------------------------- entry point


def train(config: TrainingConfig) -> dict[str, Any]:
    if config.task not in TASKS:
        raise TrainingError(f"task {config.task} is not trainable (see app/models/tasks.py)")
    log = TrainingLog()
    try:
        dataset = load_dataset(config.dataset)
    except DatasetError as error:
        raise TrainingError(str(error)) from error
    _check_dataset(config, dataset, log)
    split = split_dataset(dataset, SplitConfig.from_json(config.split))
    log.event("split", **split.report)

    if TASKS[config.task].kind == "binary_signals":
        document, metrics = _train_duplicates(config, dataset, split, log)
    else:
        document, metrics = _train_text(config, dataset, split, log)

    spec = TASKS[config.task]
    version = _version(config, dataset)
    manifest = {
        "task": config.task,
        "version": version,
        "modelFormat": document["format"],
        "featureSchemaVersion": spec.feature_schema,
        "labelSchemaVersion": spec.label_schema,
        "trainedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "codeRevision": _code_revision(),
        "dataset": {
            "name": dataset.manifest.name,
            "version": dataset.manifest.version,
            "fingerprint": dataset.fingerprint,
            "synthetic": dataset.manifest.synthetic,
            "records": dataset.report.valid,
        },
        "evaluationDataset": {
            "name": dataset.manifest.name,
            "version": dataset.manifest.version,
            "split": "test",
        },
        "split": split.report,
        "config": {
            k: v for k, v in config.__dict__.items() if k not in {"artifact_dir", "dataset"}
        },
        "configFingerprint": config.fingerprint(),
        "metrics": metrics,
    }
    path, digest = write_artifact(
        Path(config.artifact_dir), config.task, version, document, manifest
    )
    log.event("artifact", path=str(path), sha256=digest)
    log.write(path / "training_log.jsonl")
    return {**manifest, "artifact": {"path": str(path), "sha256": digest}}
