"""Registry-backed inference endpoints and artifact safety (Prompt 28)."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app
from app.models.text_features import tokenize
from ml.training import TrainingConfig, train
from tests.ml_fixtures import category_records, write_dataset


@pytest.fixture(scope="module")
def trained(tmp_path_factory: pytest.TempPathFactory) -> dict:
    root = tmp_path_factory.mktemp("serving")
    ds = write_dataset(root / "data", "problem_category", category_records())
    result = train(
        TrainingConfig(
            task="problem_category",
            dataset=str(ds),
            artifact_dir=str(root / "artifacts"),
            version="serve-v1",
            split={"seed": 3, "min_test_records": 20, "min_test_per_class": 2},
            model={"C_grid": [4.0], "min_df": 1},
            decision={"abstain_below": 0.3, "min_known_ratio": 0.3, "min_tokens": 3},
            allow_synthetic=True,
        )
    )
    return {"root": root / "artifacts", "sha": result["artifact"]["sha256"]}


@pytest.fixture
def client(trained: dict) -> TestClient:
    app.dependency_overrides[get_settings] = lambda: Settings(ML_ARTIFACT_DIR=str(trained["root"]))
    yield TestClient(app)
    app.dependency_overrides.clear()


def _ref(trained: dict, **overrides) -> dict:
    return {
        "task": "problem_category",
        "version": "serve-v1",
        "sha256": trained["sha"],
        **overrides,
    }


def test_verify_reports_schemas_and_synthetic_flag(client: TestClient, trained: dict) -> None:
    r = client.post("/models/verify", json=_ref(trained))
    assert r.status_code == 200
    body = r.json()
    assert body["feature_schema_version"] == "problem-text-v1"
    assert body["synthetic_data"] is True


def test_predict_returns_advisory_label(client: TestClient, trained: dict) -> None:
    r = client.post(
        "/models/predict",
        json={
            **_ref(trained),
            "input": {
                "title": "pothole crater",
                "description": "deep pothole crater on the asphalt road damaging tyre",
            },
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["advisory"] is True
    assert body["label"] == "POTHOLES"
    assert abs(sum(body["probabilities"].values()) - 1) < 1e-3


def test_out_of_distribution_input_abstains(client: TestClient, trained: dict) -> None:
    r = client.post(
        "/models/predict",
        json={
            **_ref(trained),
            "input": {
                "title": "quarterly budget",
                "description": "minutes of committee meeting about procurement",
            },
        },
    )
    body = r.json()
    assert body["abstained"] is True and body["label"] is None
    assert body["abstain_reason"] in {"out_of_vocabulary", "low_confidence"}


def test_missing_text_abstains_and_is_reported(client: TestClient, trained: dict) -> None:
    body = client.post("/models/predict", json={**_ref(trained), "input": {"title": "lamp"}}).json()
    assert body["abstained"] is True and body["abstain_reason"] == "too_little_text"
    assert body["missing_features"] == ["description"]


def test_input_schema_failures(client: TestClient, trained: dict) -> None:
    r = client.post(
        "/models/predict",
        json={**_ref(trained), "input": {"title": "x", "description": "y", "category": "NOPE"}},
    )
    assert r.status_code == 422
    assert r.json()["code"] == "INPUT_SCHEMA"


def test_artifact_refusals(client: TestClient, trained: dict) -> None:
    assert client.post("/models/verify", json=_ref(trained, sha256="0" * 64)).status_code == 409
    assert client.post("/models/verify", json=_ref(trained, version="missing")).status_code == 404
    traversal = client.post("/models/verify", json=_ref(trained, version="../../etc"))
    assert traversal.status_code == 422
    assert client.post("/models/verify", json=_ref(trained, task="severity")).status_code == 422


def test_corrupt_and_incompatible_artifacts_are_refused(tmp_path: Path, trained: dict) -> None:
    import shutil

    from app.models.artifacts import ArtifactError, load_artifact

    copy = tmp_path / "artifacts"
    shutil.copytree(trained["root"], copy)
    model = copy / "problem_category" / "serve-v1" / "model.json"
    model.write_text(model.read_text().replace('"labels"', '"labelz"'))
    with pytest.raises(ArtifactError) as error:
        load_artifact(copy, "problem_category", "serve-v1", trained["sha"])
    assert error.value.code == "INTEGRITY"

    shutil.rmtree(copy)
    shutil.copytree(trained["root"], copy)
    manifest_path = copy / "problem_category" / "serve-v1" / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["featureSchemaVersion"] = "problem-text-v0"
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ArtifactError) as error:
        load_artifact(copy, "problem_category", "serve-v1", trained["sha"])
    assert error.value.code == "INCOMPATIBLE"


def test_identifiers_are_redacted_before_features() -> None:
    tokens = tokenize("Call 9876543210 or ravi@example.com")
    assert "[PHONE]" in tokens and "[EMAIL]" in tokens
    assert not any("9876" in t or "example" in t for t in tokens)


def test_prediction_logs_do_not_contain_input_text(
    client: TestClient,
    trained: dict,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture,
) -> None:
    secret = "zebracrossingsecretphrase"
    with caplog.at_level(logging.DEBUG):
        client.post(
            "/models/predict",
            json={**_ref(trained), "input": {"title": secret, "description": f"{secret} pothole"}},
        )
    captured = capsys.readouterr()
    assert secret not in caplog.text + captured.out + captured.err
