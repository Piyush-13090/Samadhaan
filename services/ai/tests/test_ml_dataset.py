"""Dataset validation, privacy and versioning (Prompt 28)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ml.dataset import DatasetError, load_dataset
from tests.ml_fixtures import category_records, write_dataset


def _load(tmp_path: Path, records, task="problem_category", **overrides):
    return load_dataset(write_dataset(tmp_path / "ds", task, records, **overrides))


def test_valid_dataset_reports_distribution_and_fingerprint(tmp_path: Path) -> None:
    ds = _load(tmp_path, category_records(per_class=5))
    assert ds.report.total == ds.report.valid == 25
    assert ds.report.invalid == []
    assert ds.report.label_distribution == {
        "DRAINAGE": 5,
        "GARBAGE": 5,
        "POTHOLES": 5,
        "STREETLIGHTS": 5,
        "WATER": 5,
    }
    assert ds.fingerprint.startswith("sha256:")


def test_invalid_records_are_reported_with_reasons(tmp_path: Path) -> None:
    records = category_records(per_class=2)
    records[0]["category"] = "ROADWORKS"  # not in the taxonomy
    records[1]["label_source"] = "AI_GENERATED"  # not independent ground truth
    del records[2]["description"]
    records[3]["unexpected"] = "x"
    ds = _load(tmp_path, records)
    reasons = {r["recordId"]: " ".join(r["reasons"]) for r in ds.report.invalid}
    assert "not in the Samadhaan taxonomy" in reasons[records[0]["record_id"]]
    assert "not independent ground truth" in reasons[records[1]["record_id"]]
    assert "description" in reasons[records[2]["record_id"]]
    assert "Extra inputs" in reasons[records[3]["record_id"]]
    assert ds.report.valid == len(records) - 4
    assert ds.report.missing_values["description"] == 1


def test_duplicate_ids_are_invalid_and_duplicate_texts_reported(tmp_path: Path) -> None:
    records = category_records(per_class=2)
    records.append(dict(records[0]))  # same id
    twin = dict(records[1], record_id="twin-1")  # same text, new id
    records.append(twin)
    ds = _load(tmp_path, records)
    assert ds.report.duplicate_ids == [records[0]["record_id"]]
    assert all(r["record_id"] != records[0]["record_id"] for r in ds.records)
    assert sorted([records[1]["record_id"], "twin-1"]) in ds.report.duplicate_texts


def test_forbidden_fields_and_personal_data_are_refused(tmp_path: Path) -> None:
    records = category_records(per_class=1)
    records[0]["reporter_email"] = "someone@example.com"
    with pytest.raises(DatasetError, match="forbidden fields present: reporter_email"):
        _load(tmp_path, records)
    with pytest.raises(DatasetError, match="declares personal data"):
        _load(tmp_path / "b", category_records(per_class=1), contains_personal_data=True)


def test_identifiers_in_text_are_redacted(tmp_path: Path) -> None:
    records = category_records(per_class=1)
    records[0]["description"] = (
        "Call me on 9876543210 or mail ravi.k@example.com, Aadhaar 1234 5678 9012"
    )
    ds = _load(tmp_path, records)
    text = next(r for r in ds.records if r["record_id"] == records[0]["record_id"])["description"]
    assert "9876543210" not in text and "example.com" not in text and "9012" not in text
    assert "[PHONE]" in text and "[EMAIL]" in text and "[ID_NUMBER]" in text
    assert ds.report.redactions == {"EMAIL": 1, "ID_NUMBER": 1, "PHONE": 1}


def test_fingerprint_is_deterministic_and_order_independent(tmp_path: Path) -> None:
    records = category_records(per_class=3)
    a = _load(tmp_path / "a", records)
    b = _load(tmp_path / "b", list(reversed(records)))
    assert a.fingerprint == b.fingerprint
    changed = [dict(r) for r in records]
    changed[0]["title"] += " x"
    assert _load(tmp_path / "c", changed).fingerprint != a.fingerprint


def test_csv_records_load_like_jsonl(tmp_path: Path) -> None:
    import csv

    records = category_records(per_class=2)
    root = tmp_path / "csv"
    write_dataset(root, "problem_category", [], records_file="records.csv")
    fields = sorted({k for r in records for k in r})
    with (root / "records.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(records)
    from_csv = load_dataset(root)
    from_jsonl = _load(tmp_path, records)
    assert from_csv.fingerprint == from_jsonl.fingerprint


def test_manifest_requires_provenance(tmp_path: Path) -> None:
    root = write_dataset(tmp_path / "ds", "problem_category", category_records(per_class=1))
    data = json.loads((root / "dataset.json").read_text())
    del data["owner"]
    (root / "dataset.json").write_text(json.dumps(data))
    with pytest.raises(DatasetError, match="owner"):
        load_dataset(root)
