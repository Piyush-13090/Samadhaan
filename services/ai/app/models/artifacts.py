"""Model artifacts on disk (Prompt 28).

Layout under `ML_ARTIFACT_DIR` (never committed — see .gitignore):

    <task>/<version>/model.json      the model, canonical JSON
    <task>/<version>/manifest.json   provenance, schemas, metrics, sha256 of model.json

Loading verifies, in order: names are safe (no path traversal), the files
exist, `model.json` hashes to the manifest's sha256 *and* to the sha256 the
registry approved, the task and schema versions are ones this service
supports, and the model document is valid for its format. Any failure is an
`ArtifactError` with a code; nothing half-loads.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from app.models.linear import ModelFormatError, SignalsLogisticModel, TextSoftmaxModel, build_model
from app.models.tasks import TASKS

ArtifactErrorCode = Literal["INVALID_NAME", "NOT_FOUND", "INTEGRITY", "INCOMPATIBLE", "CORRUPT"]

_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,99}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
MODEL_FILE = "model.json"
MANIFEST_FILE = "manifest.json"


class ArtifactError(Exception):
    def __init__(self, code: ArtifactErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def canonical_json(value: Any) -> bytes:
    """Sorted keys, no whitespace: the same document always has the same bytes."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def artifact_dir(root: Path, task: str, version: str) -> Path:
    if task not in TASKS:
        raise ArtifactError("INVALID_NAME", f"unknown task {task!r}")
    if not _NAME.match(version):
        raise ArtifactError("INVALID_NAME", "version must match [a-z0-9][a-z0-9._-]*")
    base = root.resolve()
    path = (base / task / version).resolve()
    if base not in path.parents:
        raise ArtifactError("INVALID_NAME", "artifact path escapes the artifact directory")
    return path


def write_artifact(
    root: Path, task: str, version: str, model: dict[str, Any], manifest: dict[str, Any]
) -> tuple[Path, str]:
    """Writes model.json and manifest.json; returns the directory and the model sha256.

    Refuses to overwrite an existing version: a version names exactly one model.
    """
    path = artifact_dir(root, task, version)
    if (path / MODEL_FILE).exists():
        raise ArtifactError("INTEGRITY", f"artifact {task}/{version} already exists")
    path.mkdir(parents=True, exist_ok=True)
    body = canonical_json(model)
    digest = sha256_bytes(body)
    (path / MODEL_FILE).write_bytes(body)
    full = {**manifest, "artifact": {"file": MODEL_FILE, "sha256": digest, "bytes": len(body)}}
    (path / MANIFEST_FILE).write_text(json.dumps(full, indent=2, sort_keys=True) + "\n")
    return path, digest


@dataclass(frozen=True)
class LoadedArtifact:
    task: str
    version: str
    sha256: str
    manifest: dict[str, Any]
    model: TextSoftmaxModel | SignalsLogisticModel

    @property
    def feature_schema(self) -> str:
        return str(self.manifest.get("featureSchemaVersion"))

    @property
    def label_schema(self) -> str:
        return str(self.manifest.get("labelSchemaVersion"))

    @property
    def synthetic(self) -> bool:
        return bool(self.manifest.get("dataset", {}).get("synthetic", True))


def load_artifact(root: Path, task: str, version: str, expected_sha256: str) -> LoadedArtifact:
    if not _SHA256.match(expected_sha256 or ""):
        raise ArtifactError("INVALID_NAME", "expected sha256 must be 64 lowercase hex characters")
    path = artifact_dir(root, task, version)
    try:
        body = (path / MODEL_FILE).read_bytes()
        manifest = json.loads((path / MANIFEST_FILE).read_text())
    except FileNotFoundError as error:
        raise ArtifactError("NOT_FOUND", f"artifact {task}/{version} not found") from error
    except (OSError, json.JSONDecodeError) as error:
        raise ArtifactError("CORRUPT", "artifact manifest is unreadable") from error

    digest = sha256_bytes(body)
    if digest != manifest.get("artifact", {}).get("sha256"):
        raise ArtifactError("INTEGRITY", "model.json does not match its manifest")
    if digest != expected_sha256:
        raise ArtifactError("INTEGRITY", "model.json does not match the registered sha256")

    spec = TASKS[task]
    if manifest.get("task") != task or manifest.get("version") != version:
        raise ArtifactError("INCOMPATIBLE", "manifest names a different task or version")
    if (
        manifest.get("featureSchemaVersion") != spec.feature_schema
        or manifest.get("labelSchemaVersion") != spec.label_schema
    ):
        raise ArtifactError("INCOMPATIBLE", "artifact schema versions are not supported")

    try:
        document = json.loads(body)
        model = build_model(document)
    except (json.JSONDecodeError, ModelFormatError) as error:
        raise ArtifactError("CORRUPT", f"model document is invalid: {error}") from error
    if list(model.labels) != list(spec.labels) and spec.kind != "binary_signals":
        raise ArtifactError("INCOMPATIBLE", "model labels differ from the task taxonomy")
    return LoadedArtifact(task, version, digest, manifest, model)
