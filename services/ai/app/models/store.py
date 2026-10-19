"""Loaded-model cache for serving (Prompt 28).

Keyed by (task, version, sha256), so a re-approved artifact with different
bytes can never be served from a stale cache entry. Small and bounded: only
the active version (and, briefly, a rollback target) is ever requested.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from pathlib import Path

from app.models.artifacts import LoadedArtifact, load_artifact

_MAX_ENTRIES = 8


class ModelStore:
    def __init__(self, root: Path, max_entries: int = _MAX_ENTRIES) -> None:
        self.root = root
        self.max_entries = max_entries
        self._cache: OrderedDict[tuple[str, str, str], LoadedArtifact] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, task: str, version: str, sha256: str) -> LoadedArtifact:
        key = (task, version, sha256)
        with self._lock:
            hit = self._cache.get(key)
            if hit is not None:
                self._cache.move_to_end(key)
                return hit
        loaded = load_artifact(self.root, task, version, sha256)
        with self._lock:
            self._cache[key] = loaded
            while len(self._cache) > self.max_entries:
                self._cache.popitem(last=False)
        return loaded


_stores: dict[str, ModelStore] = {}


def store_for(root: str) -> ModelStore:
    """One store per configured directory (tests point at temporary ones)."""
    if root not in _stores:
        _stores[root] = ModelStore(Path(root))
    return _stores[root]
