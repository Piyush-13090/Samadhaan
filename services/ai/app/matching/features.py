"""Feature extraction for organisation matching.

Every function here is pure and deterministic, so a score can be reproduced
from its inputs and the engine can be tested without a model.
"""

from __future__ import annotations

import math
from typing import Final

# ---------------------------------------------------------------------------
# Category compatibility
# ---------------------------------------------------------------------------

# Families of the problem taxonomy whose work genuinely overlaps. This is the
# *structure of the taxonomy* — which categories share skills, equipment and
# institutions — not a rule about which organisation type handles what.
# A category may belong to several families.
CATEGORY_FAMILIES: Final[dict[str, frozenset[str]]] = {
    "mobility": frozenset({"ROADS", "POTHOLES", "TRAFFIC", "PUBLIC_TRANSPORT"}),
    "water": frozenset({"WATER", "DRAINAGE"}),
    "sanitation": frozenset({"SANITATION", "GARBAGE", "DRAINAGE"}),
    "energy": frozenset({"ELECTRICITY", "STREETLIGHTS"}),
    "environment": frozenset({"POLLUTION", "PARKS", "GARBAGE"}),
    "public_space": frozenset({"PARKS", "PUBLIC_INFRASTRUCTURE", "PUBLIC_SAFETY"}),
    "safety": frozenset({"PUBLIC_SAFETY", "TRAFFIC", "STREETLIGHTS"}),
}

EXACT_CATEGORY: Final = 1.0
SAME_FAMILY: Final = 0.6
#: How much the AI's category counts when it disagrees with the reporter's.
AI_CATEGORY_DISCOUNT: Final = 0.9


def category_compatibility(problem_category: str, expertise_category: str) -> float:
    """1 for the same category, 0.6 for one in a shared family, else 0."""
    if problem_category == expertise_category:
        return EXACT_CATEGORY
    if problem_category == "OTHER" or expertise_category == "OTHER":
        return 0.0
    for members in CATEGORY_FAMILIES.values():
        if problem_category in members and expertise_category in members:
            return SAME_FAMILY
    return 0.0


def problem_category_compatibility(
    category: str, ai_category: str | None, expertise_category: str
) -> float:
    """Compatibility against the reporter's category, or the AI's when better.

    The reporter chose a category; the AI may disagree. Both are evidence, the
    AI's slightly discounted because it is a second opinion, not the record.
    """
    score = category_compatibility(category, expertise_category)
    if ai_category and ai_category != category:
        score = max(
            score,
            AI_CATEGORY_DISCOUNT * category_compatibility(ai_category, expertise_category),
        )
    return score


# ---------------------------------------------------------------------------
# Expertise levels
# ---------------------------------------------------------------------------

LEVEL_WEIGHT: Final[dict[str, float]] = {
    "SPECIALIST": 1.0,
    "EXPERIENCED": 0.85,
    "INTERESTED": 0.6,
}

# ---------------------------------------------------------------------------
# Similarity rescaling
# ---------------------------------------------------------------------------


def rescale(cosine: float | None, floor: float, ceiling: float) -> float | None:
    """Maps a raw cosine similarity onto 0–1 for the band where it is informative.

    Sentence-embedding cosines between unrelated texts rarely fall to zero, and
    between related ones rarely reach one. Below `floor` the texts are treated
    as unrelated; at or above `ceiling`, as strongly related.
    """
    if cosine is None or math.isnan(cosine):
        return None
    if ceiling <= floor:
        raise ValueError("ceiling must exceed floor")
    return max(0.0, min(1.0, (cosine - floor) / (ceiling - floor)))


#: Problem text against a whole organisation profile.
SEMANTIC_FLOOR: Final = 0.10
SEMANTIC_CEILING: Final = 0.60
#: Problem text against one short expertise phrase, or a type description.
PHRASE_FLOOR: Final = 0.10
PHRASE_CEILING: Final = 0.55

# ---------------------------------------------------------------------------
# Geography — a weak signal by design
# ---------------------------------------------------------------------------

#: Distance at which the geographic score falls to about 0.37.
GEOGRAPHIC_SCALE_METERS: Final = 25_000.0
SAME_CITY_SCORE: Final = 0.6
#: An organisation with no registered location is neither near nor far.
UNKNOWN_LOCATION_SCORE: Final = 0.3


def geographic_relevance(
    distance_meters: float | None, same_city: bool, has_location: bool
) -> float:
    """Exponential decay with distance; a city match; or a neutral prior.

    Never zero for "unknown": a new organisation that has not yet set its
    location must not be ranked as if it were on the other side of the
    country. Geography carries only a small weight in the composite anyway.
    """
    if distance_meters is not None:
        return math.exp(-max(0.0, distance_meters) / GEOGRAPHIC_SCALE_METERS)
    if same_city:
        return SAME_CITY_SCORE
    if not has_location:
        return UNKNOWN_LOCATION_SCORE
    return 0.0


# ---------------------------------------------------------------------------
# Activity — neutral for newcomers
# ---------------------------------------------------------------------------

ACTIVITY_BASELINE: Final = 0.5
ACTIVITY_SATURATION: Final = 3


def activity_score(relevant_activity_count: int) -> float:
    """0.5 for an organisation with no history, rising to 1 at three
    related contributions.

    Starting at the midpoint rather than zero is the cold-start guarantee: a
    new organisation is not penalised for having no past, and an active one
    gains at most half of a 5% weight — history cannot outrank relevance.
    """
    count = max(0, relevant_activity_count)
    return ACTIVITY_BASELINE + ACTIVITY_BASELINE * min(1.0, count / ACTIVITY_SATURATION)


# ---------------------------------------------------------------------------
# Organisation type, described rather than ruled
# ---------------------------------------------------------------------------

# What each kind of organisation does, in plain words. The capability signal
# is the semantic similarity between a problem and these descriptions — so a
# "research the causes of flooding" report leans university and a "repair the
# collapsed culvert" report leans industry, without any rule that says
# "drainage = industry".
TYPE_DESCRIPTIONS: Final[dict[str, str]] = {
    "NGO": (
        "Community mobilisation, public awareness campaigns, volunteer drives, "
        "local advocacy, outreach to residents and grassroots service delivery."
    ),
    "UNIVERSITY": (
        "Research, surveys, data collection and analysis, technical studies, "
        "mapping, monitoring, pilots of new technology and student projects."
    ),
    "INDUSTRY": (
        "Engineering, construction, repair and maintenance works, equipment, "
        "materials, contractors and large-scale technical implementation."
    ),
}


def cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity. Inputs from the provider are already unit length,
    but this does not assume it."""
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


__all__ = [
    "CATEGORY_FAMILIES",
    "LEVEL_WEIGHT",
    "TYPE_DESCRIPTIONS",
    "activity_score",
    "category_compatibility",
    "cosine",
    "geographic_relevance",
    "problem_category_compatibility",
    "rescale",
]
