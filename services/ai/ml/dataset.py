"""Dataset import, validation and versioning (Prompt 28).

A dataset is a directory with `dataset.json` (provenance, see
`schemas.DatasetManifest`) and one JSONL or CSV records file. Loading:

1. validates the manifest — refuses datasets that declare personal data;
2. refuses forbidden columns by name (`privacy.FORBIDDEN_FIELDS`);
3. validates every record against its task schema and the taxonomy, collecting
   actionable reasons per invalid record instead of stopping at the first;
4. redacts identifiers in free text;
5. detects duplicate record ids and duplicate texts;
6. reports missing values and the label distribution;
7. fingerprints the preprocessed, valid records (sha256 over canonical JSON,
   sorted by record id), so the same inputs and configuration always produce
   the same fingerprint, and any change produces a different one.
"""

from __future__ import annotations

import csv
import hashlib
import json
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ml.privacy import forbidden_fields, redact_text
from ml.schemas import LABEL_FIELD, RECORD_SCHEMAS, TEXT_FIELDS, DatasetManifest

#: Bumped whenever preprocessing changes, so fingerprints from different
#: preprocessing never compare equal.
PREPROCESSING_VERSION = "preprocess-v1"


class DatasetError(Exception):
    """The dataset cannot be used at all (as opposed to individual bad records)."""


@dataclass
class ValidationReport:
    total: int = 0
    valid: int = 0
    invalid: list[dict[str, Any]] = field(default_factory=list)
    duplicate_ids: list[str] = field(default_factory=list)
    duplicate_texts: list[list[str]] = field(default_factory=list)
    missing_values: dict[str, int] = field(default_factory=dict)
    label_distribution: dict[str, int] = field(default_factory=dict)
    redactions: dict[str, int] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "valid": self.valid,
            "invalidCount": len(self.invalid),
            "invalid": self.invalid[:200],
            "duplicateIds": self.duplicate_ids,
            "duplicateTextGroups": self.duplicate_texts,
            "missingValues": self.missing_values,
            "labelDistribution": self.label_distribution,
            "redactions": self.redactions,
        }


@dataclass
class Dataset:
    manifest: DatasetManifest
    records: list[dict[str, Any]]
    report: ValidationReport
    fingerprint: str

    @property
    def task(self) -> str:
        return self.manifest.task

    @property
    def label_field(self) -> str:
        return LABEL_FIELD[self.task]


def _read_rows(path: Path) -> list[dict[str, Any]]:
    if path.suffix == ".jsonl":
        rows = []
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise DatasetError(f"line {n}: not valid JSON ({error.msg})") from error
            if not isinstance(value, dict):
                raise DatasetError(f"line {n}: each line must be a JSON object")
            rows.append(value)
        return rows
    with path.open(newline="", encoding="utf-8") as handle:
        # Empty CSV cells mean "absent", the same as a missing JSON key.
        return [{k: v for k, v in row.items() if v != ""} for row in csv.DictReader(handle)]


def _normalise_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split())


def _jsonable(record: dict[str, Any]) -> dict[str, Any]:
    """Datetimes become UTC ISO strings (naive values are taken as UTC), so
    ordering and fingerprints do not depend on the source's offsets."""
    out: dict[str, Any] = {}
    for key, value in record.items():
        if isinstance(value, datetime):
            aware = value if value.tzinfo else value.replace(tzinfo=UTC)
            value = aware.astimezone(UTC).isoformat().replace("+00:00", "Z")
        out[key] = value
    return out


def _canonical(record: dict[str, Any]) -> str:
    return json.dumps(record, sort_keys=True, separators=(",", ":"), default=str)


def load_dataset(directory: Path | str) -> Dataset:
    directory = Path(directory)
    try:
        manifest = DatasetManifest.model_validate_json(
            (directory / "dataset.json").read_text(encoding="utf-8")
        )
    except FileNotFoundError as error:
        raise DatasetError(f"{directory}/dataset.json not found") from error
    except ValidationError as error:
        raise DatasetError(f"dataset.json is invalid: {error}") from error
    if manifest.contains_personal_data:
        raise DatasetError(
            "dataset declares personal data; pseudonymise and remove it before import "
            "(docs/ML_DATASETS.md#privacy)"
        )

    rows = _read_rows(directory / manifest.records_file)
    columns = set().union(*(row.keys() for row in rows)) if rows else set()
    refused = forbidden_fields(columns)
    if refused:
        raise DatasetError(f"forbidden fields present: {', '.join(refused)}")

    schema = RECORD_SCHEMAS[manifest.task]
    label_field = LABEL_FIELD[manifest.task]
    report = ValidationReport(total=len(rows))
    redactions: Counter[str] = Counter()
    missing: Counter[str] = Counter()
    valid: list[dict[str, Any]] = []
    seen_ids: Counter[str] = Counter()

    for index, row in enumerate(rows):
        for name in schema.model_fields:
            if row.get(name) in (None, ""):
                missing[name] += 1
        try:
            record = _jsonable(schema.model_validate(row).model_dump())
        except ValidationError as error:
            report.invalid.append(
                {
                    "row": index + 1,
                    "recordId": str(row.get("record_id", ""))[:120] or None,
                    "reasons": [
                        f"{'.'.join(map(str, e['loc'])) or 'record'}: {e['msg']}"
                        for e in error.errors()
                    ],
                }
            )
            continue
        for name in TEXT_FIELDS:
            if isinstance(record.get(name), str):
                text, counts = redact_text(_normalise_text(record[name]))
                record[name] = " ".join(text.split())
                redactions.update(counts)
        seen_ids[record["record_id"]] += 1
        valid.append(record)

    report.duplicate_ids = sorted(rid for rid, c in seen_ids.items() if c > 1)
    if report.duplicate_ids:
        for rid in report.duplicate_ids:
            report.invalid.append(
                {"row": None, "recordId": rid, "reasons": ["record_id appears more than once"]}
            )
        valid = [r for r in valid if r["record_id"] not in set(report.duplicate_ids)]

    by_text: dict[str, list[str]] = defaultdict(list)
    for record in valid:
        if "title" in record:
            key = f"{record['title'].lower()}\n{record['description'].lower()}"
            by_text[key].append(record["record_id"])
    report.duplicate_texts = sorted(sorted(ids) for ids in by_text.values() if len(ids) > 1)

    valid.sort(key=lambda r: r["record_id"])
    report.valid = len(valid)
    report.missing_values = dict(sorted(missing.items()))
    report.label_distribution = dict(sorted(Counter(str(r[label_field]) for r in valid).items()))
    report.redactions = dict(sorted(redactions.items()))

    digest = hashlib.sha256()
    digest.update(f"{PREPROCESSING_VERSION}\n{manifest.task}\n".encode())
    for record in valid:
        digest.update(_canonical(record).encode())
        digest.update(b"\n")
    return Dataset(manifest, valid, report, f"sha256:{digest.hexdigest()}")
