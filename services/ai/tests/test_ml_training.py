"""Training pipeline on synthetic fixtures (Prompt 28).

These prove the pipeline runs end to end and fails safely; the numbers they
produce describe synthetic data only.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.models.artifacts import ArtifactError, load_artifact
from ml.cli import main, registration_body
from ml.splitting import InsufficientDataError
from ml.training import TrainingConfig, TrainingError, train
from tests.ml_fixtures import category_records, duplicate_records, severity_records, write_dataset

SPLIT = {"seed": 3, "min_test_records": 20, "min_test_per_class": 2, "min_train_per_class": 3}


def _config(tmp_path: Path, task: str, records, **overrides) -> TrainingConfig:
    ds = write_dataset(tmp_path / "data", task, records)
    base = {
        "task": task,
        "dataset": str(ds),
        "artifact_dir": str(tmp_path / "artifacts"),
        "split": SPLIT,
        "model": {"C_grid": [1.0, 4.0], "min_df": 1},
        "allow_synthetic": True,
    }
    return TrainingConfig(**{**base, **overrides})


def test_category_training_writes_a_verifiable_artifact(tmp_path: Path) -> None:
    result = train(_config(tmp_path, "problem_category", category_records()))
    sha = result["artifact"]["sha256"]
    loaded = load_artifact(tmp_path / "artifacts", "problem_category", result["version"], sha)
    assert loaded.synthetic is True
    test = result["metrics"]["test"]
    # Computed from predictions on held-out records: the numbers are bounded
    # and consistent with the confusion matrix, not asserted to be "good".
    assert test["n"] == result["split"]["records"]["test"]
    assert sum(map(sum, test["confusionMatrix"])) + test["abstained"] == test["n"]
    assert 0.0 <= test["macroF1"] <= 1.0
    assert "majorityClass" in result["metrics"]["baselines"]
    assert "existingSystem" in result["metrics"]["baselines"]
    assert result["dataset"]["fingerprint"].startswith("sha256:")
    log = (Path(result["artifact"]["path"]) / "training_log.jsonl").read_text()
    steps = [json.loads(line)["step"] for line in log.splitlines()]
    assert steps[:3] == ["dataset", "split", "features"] and "selected" in steps
    # Selection never sees the test split: only validation scores are logged.
    assert "test" not in "".join(line for line in log.splitlines() if '"selection"' in line)


def test_training_is_reproducible(tmp_path: Path) -> None:
    records = category_records()
    a = train(_config(tmp_path / "a", "problem_category", records, version="v-a"))
    b = train(_config(tmp_path / "b", "problem_category", records, version="v-a"))
    assert a["artifact"]["sha256"] == b["artifact"]["sha256"]
    assert a["metrics"]["test"] == b["metrics"]["test"]


def test_a_version_is_never_overwritten(tmp_path: Path) -> None:
    config = _config(tmp_path, "problem_category", category_records(), version="fixed")
    train(config)
    with pytest.raises(ArtifactError, match="already exists"):
        train(config)


def test_severity_is_evaluated_ordinally(tmp_path: Path) -> None:
    result = train(
        _config(
            tmp_path, "problem_severity", severity_records(), split={**SPLIT, "strategy": "time"}
        )
    )
    test = result["metrics"]["test"]
    assert {"meanAbsoluteError", "quadraticWeightedKappa", "mostSevere"} <= set(test)
    assert result["split"]["strategy"] == "time"


def test_duplicate_training_picks_a_precision_first_threshold(tmp_path: Path) -> None:
    result = train(
        _config(
            tmp_path,
            "duplicate_pair",
            duplicate_records(),
            split={**SPLIT, "min_test_per_class": 1},
            decision={"min_precision": 0.9},
        )
    )
    test = result["metrics"]["test"]
    assert {"averagePrecision", "prCurve", "falsePositives"} <= set(test)
    assert "existingCombinedScore" in result["metrics"]["baselines"]


def test_refusals(tmp_path: Path) -> None:
    with pytest.raises(TrainingError, match="synthetic"):
        train(
            _config(tmp_path / "s", "problem_category", category_records(), allow_synthetic=False)
        )
    bad = category_records()
    bad[0]["category"] = "NOT_A_CATEGORY"
    with pytest.raises(TrainingError, match="invalid records"):
        train(_config(tmp_path / "i", "problem_category", bad))
    with pytest.raises(InsufficientDataError):
        train(_config(tmp_path / "n", "problem_category", category_records(per_class=4)))
    with pytest.raises(TrainingError, match="not trainable"):
        train(_config(tmp_path / "o", "organization_relevance", []))


def test_cli_train_then_registration_body(tmp_path: Path) -> None:
    config = _config(tmp_path, "problem_category", category_records(), version="cli-v1")
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config.__dict__))
    assert main(["train", "--config", str(path), "--out", str(tmp_path / "result.json")]) == 0
    body = registration_body(tmp_path / "artifacts" / "problem_category" / "cli-v1")
    assert body["task"] == "PROBLEM_CATEGORY" and body["syntheticData"] is True
    assert len(body["artifactSha256"]) == 64
    assert body["metrics"]["test"]["n"] > 0
    # Insufficient data exits 1 with reasons rather than inventing a run.
    small = _config(tmp_path / "small", "problem_category", category_records(per_class=3))
    small_path = tmp_path / "small.json"
    small_path.write_text(json.dumps(small.__dict__))
    assert main(["train", "--config", str(small_path)]) == 1
