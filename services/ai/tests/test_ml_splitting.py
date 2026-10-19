"""Leakage-aware, deterministic splits (Prompt 28)."""

from __future__ import annotations

from pathlib import Path

import pytest

from ml.dataset import load_dataset
from ml.splitting import InsufficientDataError, SplitConfig, split_dataset
from tests.ml_fixtures import category_records, duplicate_records, severity_records, write_dataset


def _ids(records):
    return {r["record_id"] for r in records}


def test_split_is_deterministic_and_disjoint(tmp_path: Path) -> None:
    ds = load_dataset(write_dataset(tmp_path / "a", "problem_category", category_records()))
    one = split_dataset(ds, SplitConfig(seed=1, min_test_records=10), check_classes=False)
    two = split_dataset(ds, SplitConfig(seed=1, min_test_records=10), check_classes=False)
    assert [r["record_id"] for r in one.test] == [r["record_id"] for r in two.test]
    assert not (_ids(one.train) & _ids(one.test)) and not (_ids(one.train) & _ids(one.validation))
    assert len(one.train) + len(one.validation) + len(one.test) == len(ds.records)
    other = split_dataset(ds, SplitConfig(seed=2, min_test_records=10), check_classes=False)
    assert _ids(other.test) != _ids(one.test)


def test_incidents_and_repeated_texts_stay_in_one_split(tmp_path: Path) -> None:
    records = category_records()
    for r in records[:30]:
        r["incident_id"] = "incident-a"  # one incident, many reports
    clone = dict(records[40], record_id="clone-of-40")  # verbatim resubmission
    records.append(clone)
    ds = load_dataset(write_dataset(tmp_path / "a", "problem_category", records))
    split = split_dataset(ds, SplitConfig(seed=5, min_test_records=1), check_classes=False)
    for part in (split.train, split.validation, split.test):
        ids = _ids(part)
        assert {r["record_id"] for r in records[:30]} <= ids or not (
            {r["record_id"] for r in records[:30]} & ids
        )
        assert ({records[40]["record_id"], "clone-of-40"} <= ids) or not (
            {records[40]["record_id"], "clone-of-40"} & ids
        )


def test_duplicate_pairs_sharing_a_problem_never_cross_splits(tmp_path: Path) -> None:
    records = duplicate_records(pairs=120)
    # Chain pairs through shared problems: pair 2k and 2k+1 share problem_b.
    for i in range(0, 120, 2):
        records[i + 1]["problem_a"] = records[i]["problem_b"]
    ds = load_dataset(write_dataset(tmp_path / "d", "duplicate_pair", records))
    split = split_dataset(ds, SplitConfig(seed=9, min_test_records=1), check_classes=False)
    side = {}
    for name in ("train", "validation", "test"):
        for r in split.part(name):
            for problem in (r["problem_a"], r["problem_b"]):
                assert side.setdefault(problem, name) == name, f"{problem} leaks across splits"


def test_time_split_puts_newest_groups_in_test(tmp_path: Path) -> None:
    ds = load_dataset(write_dataset(tmp_path / "s", "problem_severity", severity_records()))
    split = split_dataset(
        ds, SplitConfig(strategy="time", min_test_records=10), check_classes=False
    )
    assert max(r["created_at"] for r in split.train) <= min(r["created_at"] for r in split.test)


def test_geographic_holdout(tmp_path: Path) -> None:
    ds = load_dataset(write_dataset(tmp_path / "g", "problem_category", category_records()))
    split = split_dataset(
        ds,
        SplitConfig(strategy="geographic", holdout_cities=("Nagpur",), min_test_records=10),
        check_classes=False,
    )
    assert {r["city"] for r in split.test} == {"Nagpur"}
    assert "Nagpur" not in {r["city"] for r in split.train + split.validation}


def test_too_little_data_is_reported_not_trained(tmp_path: Path) -> None:
    ds = load_dataset(
        write_dataset(tmp_path / "t", "problem_category", category_records(per_class=3))
    )
    with pytest.raises(InsufficientDataError) as error:
        split_dataset(ds, SplitConfig())
    assert any("test split has" in reason for reason in error.value.reasons)
