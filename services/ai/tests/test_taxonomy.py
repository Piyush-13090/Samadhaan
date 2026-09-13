"""Taxonomy normalisation.

The model cannot be trusted to emit exactly the enum strings, and a category
that slips through wrong sends a problem to the wrong department.
"""

from __future__ import annotations

from app.core.taxonomy import (
    CATEGORIES,
    clamp_confidence,
    normalise_category,
    normalise_severity,
    normalise_urgency,
)


class TestNormaliseCategory:
    def test_accepts_canonical_values(self) -> None:
        for category in CATEGORIES:
            assert normalise_category(category) == category

    def test_is_case_and_separator_insensitive(self) -> None:
        assert normalise_category("roads") == "ROADS"
        assert normalise_category("public safety") == "PUBLIC_SAFETY"
        assert normalise_category("public-safety") == "PUBLIC_SAFETY"
        assert normalise_category("  Public_Safety  ") == "PUBLIC_SAFETY"

    def test_maps_known_synonyms(self) -> None:
        assert normalise_category("Road Infrastructure") == "ROADS"
        assert normalise_category("pothole") == "POTHOLES"
        assert normalise_category("waste management") == "GARBAGE"
        assert normalise_category("sewage") == "DRAINAGE"
        assert normalise_category("street light") == "STREETLIGHTS"

    # Rejected, not guessed: a wrong mapping is worse than a visible failure.
    def test_rejects_anything_it_cannot_map(self) -> None:
        assert normalise_category("SPACE_JUNK") is None
        assert normalise_category("") is None
        assert normalise_category(None) is None


class TestNormaliseLevels:
    def test_accepts_canonical_levels(self) -> None:
        for level in ("LOW", "MEDIUM", "HIGH", "CRITICAL"):
            assert normalise_severity(level) == level
            assert normalise_urgency(level) == level

    def test_maps_common_phrasings(self) -> None:
        assert normalise_severity("severe") == "CRITICAL"
        assert normalise_severity("very high") == "CRITICAL"
        assert normalise_severity("moderate") == "MEDIUM"
        assert normalise_severity("minor") == "LOW"

    def test_rejects_unknown_levels(self) -> None:
        assert normalise_severity("catastrophic") is None
        assert normalise_urgency("whenever") is None


class TestClampConfidence:
    def test_passes_through_a_valid_fraction(self) -> None:
        assert clamp_confidence(0.94) == 0.94
        assert clamp_confidence(0) == 0.0
        assert clamp_confidence(1) == 1.0

    # A model asked for a fraction sometimes answers with a percentage. A bare
    # clamp would turn 94 into 1.0 — maximum certainty, the opposite of what
    # the value is meant to express.
    def test_converts_a_percentage_rather_than_saturating(self) -> None:
        assert clamp_confidence(94) == 0.94
        assert clamp_confidence(100) == 1.0
        assert clamp_confidence(5) == 0.05

    def test_clamps_out_of_range_values(self) -> None:
        assert clamp_confidence(-3) == 0.0
        assert clamp_confidence(1000) == 1.0

    def test_rejects_unusable_values(self) -> None:
        assert clamp_confidence(None) is None
        assert clamp_confidence(float("nan")) is None
        assert clamp_confidence("high") is None  # type: ignore[arg-type]
