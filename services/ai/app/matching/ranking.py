"""Ranking, with light diversity.

Relevance always comes first. Diversity only ever swaps in an organisation of
an unrepresented type when it is itself clearly relevant — at least
`DIVERSITY_FLOOR` and within `DIVERSITY_RATIO` of the best score — and only in
place of the weakest entry of an over-represented type. It never invents
relevance and never reorders: the final list is sorted by score.
"""

from __future__ import annotations

from typing import Final

from app.matching.engine import ScoredCandidate

DIVERSITY_FLOOR: Final = 0.5
DIVERSITY_RATIO: Final = 0.8


def rank(scored: list[ScoredCandidate], *, limit: int, min_score: float) -> list[ScoredCandidate]:
    eligible = sorted(
        (entry for entry in scored if entry.final_score >= min_score),
        # Ties broken by id, so a run is reproducible.
        key=lambda entry: (-entry.final_score, entry.candidate.organization_id),
    )
    selected = eligible[:limit]
    if not selected or len(eligible) <= limit:
        return selected

    best = selected[0].final_score
    represented = {entry.candidate.type for entry in selected}

    for entry in eligible[limit:]:
        kind = entry.candidate.type
        if kind in represented:
            continue
        if entry.final_score < max(DIVERSITY_FLOOR, min_score, DIVERSITY_RATIO * best):
            continue

        counts: dict[str, int] = {}
        for chosen in selected:
            counts[chosen.candidate.type] = counts.get(chosen.candidate.type, 0) + 1

        # Replace the weakest member of a type that would still be present.
        for position in range(len(selected) - 1, -1, -1):
            if counts[selected[position].candidate.type] > 1:
                selected[position] = entry
                represented.add(kind)
                break

    selected.sort(key=lambda entry: (-entry.final_score, entry.candidate.organization_id))
    return selected


__all__ = ["DIVERSITY_FLOOR", "DIVERSITY_RATIO", "rank"]
