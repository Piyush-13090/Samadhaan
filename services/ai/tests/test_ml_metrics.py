"""Metric definitions against hand-computed examples (Prompt 28)."""

from __future__ import annotations

import pytest
from sklearn.metrics import average_precision_score, cohen_kappa_score, f1_score

from ml.metrics import (
    average_precision,
    binary_report,
    classification_report,
    ordinal_report,
    ranking_report,
    slice_report,
    spearman,
    verification_report,
)


def test_classification_report_by_hand() -> None:
    y_true = ["A", "A", "A", "B", "B", "C"]
    y_pred = ["A", "A", "B", "B", "C", "C"]
    r = classification_report(y_true, y_pred, ["A", "B", "C"])
    # A: tp2 fp0 fn1 -> p1 r.667 f.8 ; B: tp1 fp1 fn1 -> .5 ; C: tp1 fp1 fn0 -> p.5 r1 f.667
    assert r["perClass"]["A"] == {"precision": 1.0, "recall": 0.666667, "f1": 0.8, "support": 3}
    assert r["perClass"]["B"]["f1"] == 0.5
    assert r["perClass"]["C"]["f1"] == pytest.approx(0.666667, abs=1e-6)
    assert r["macroF1"] == pytest.approx(f1_score(y_true, y_pred, average="macro"), abs=1e-6)
    assert r["confusionMatrix"] == [[2, 1, 0], [0, 1, 1], [0, 0, 1]]
    assert r["accuracy"] == pytest.approx(4 / 6, abs=1e-6)
    assert r["imbalance"]["maxToMinRatio"] == 3.0


def test_abstentions_lower_recall_and_coverage_not_precision() -> None:
    r = classification_report(["A", "A", "B"], ["A", None, "B"], ["A", "B"])
    assert r["perClass"]["A"]["precision"] == 1.0
    assert r["perClass"]["A"]["recall"] == 0.5
    assert r["coverage"] == pytest.approx(2 / 3, abs=1e-6)
    assert r["abstained"] == 1


def test_ordinal_report_matches_reference_kappa_and_flags_severe_misses() -> None:
    order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    y_true = ["LOW", "MEDIUM", "HIGH", "CRITICAL", "CRITICAL", "HIGH"]
    y_pred = ["LOW", "HIGH", "HIGH", "HIGH", "CRITICAL", "MEDIUM"]
    r = ordinal_report(y_true, y_pred, order)
    assert r["meanAbsoluteError"] == pytest.approx(3 / 6, abs=1e-6)
    assert r["withinOneLevel"] == 1.0
    assert r["quadraticWeightedKappa"] == pytest.approx(
        cohen_kappa_score(y_true, y_pred, labels=order, weights="quadratic"), abs=1e-6
    )
    assert r["mostSevere"] == {
        "label": "CRITICAL",
        "support": 2,
        "underPredictedOrAbstained": 1,
        "recall": 0.5,
    }


def test_average_precision_matches_scikit_learn() -> None:
    y = [True, False, True, True, False, False, True]
    s = [0.9, 0.8, 0.8, 0.4, 0.35, 0.1, 0.05]
    assert average_precision(y, s) == pytest.approx(average_precision_score(y, s), abs=1e-9)


def test_binary_report_counts_and_examples() -> None:
    r = binary_report([True, False, True, False], [0.9, 0.7, 0.3, 0.1], 0.5, ["a", "b", "c", "d"])
    assert (r["tp"], r["fp"], r["fn"], r["tn"]) == (1, 1, 1, 1)
    assert r["precision"] == r["recall"] == 0.5
    assert r["falsePositives"] == ["b"] and r["falseNegatives"] == ["c"]


def test_ranking_report_by_hand() -> None:
    # q1: ranked x(0) y(3) z(1) -> first relevant at rank 2 ; q2: ranked a(2) b(0)
    judgements = [
        ("q1", "x", 0, 0.9),
        ("q1", "y", 3, 0.8),
        ("q1", "z", 1, 0.1),
        ("q2", "a", 2, 0.7),
        ("q2", "b", 0, 0.2),
        ("q3", "m", 0, 0.5),
    ]
    r = ranking_report(judgements, ks=(1, 2))
    assert r["mrr"] == pytest.approx((1 / 2 + 1) / 2)
    assert r["precision@1"] == pytest.approx(0.5)
    assert r["recall@2"] == pytest.approx((1 / 2 + 1) / 2)
    # q1 ndcg@2 = (0 + 7/log2(3)) / (7 + 1/log2(3)); q2 = 1
    import math

    q1 = (7 / math.log2(3)) / (7 + 1 / math.log2(3))
    assert r["ndcg@2"] == pytest.approx((q1 + 1) / 2, abs=1e-6)
    assert r["withoutRelevant"] == 1 and r["evaluatedQueries"] == 2


def test_verification_report_isolates_false_resolution() -> None:
    y_true = ["RESOLVED", "NOT_RESOLVED", "INSUFFICIENT_EVIDENCE", "NOT_RESOLVED"]
    y_pred = ["RESOLVED", "RESOLVED", "INSUFFICIENT_EVIDENCE", "NOT_RESOLVED"]
    r = verification_report(y_true, y_pred)
    assert r["falseResolution"] == {"count": 1, "outOf": 3, "rate": pytest.approx(1 / 3, abs=1e-6)}
    assert r["insufficientEvidence"]["recall"] == 1.0


def test_spearman_and_slice_suppression() -> None:
    assert spearman([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1.0)
    assert spearman([1, 2, 3, 4], [4, 3, 2, 1]) == pytest.approx(-1.0)
    groups = ["Pune"] * 30 + ["Tiny"] * 3
    y = ["A"] * 33
    r = slice_report(groups, y, y, ["A", "B"], min_group_size=30)
    assert list(r["groups"]) == ["Pune"]
    assert r["suppressedGroups"] == 1
