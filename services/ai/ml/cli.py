"""Command line for the ML pipeline (Prompt 28). Run from services/ai:

    .venv/bin/python -m ml validate  --dataset <dir> [--out report.json]
    .venv/bin/python -m ml split     --dataset <dir> --config <split.json>
    .venv/bin/python -m ml evaluate  --dataset <dir> [--split test --config <split.json>]
    .venv/bin/python -m ml train     --config <training.json>
    .venv/bin/python -m ml registration --artifact <dir>   # body for POST /admin/ml/models

Exit codes: 0 success, 1 invalid or insufficient data, 2 usage error.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from ml.dataset import DatasetError, load_dataset
from ml.evaluate import EvaluationError, evaluate_records
from ml.splitting import InsufficientDataError, SplitConfig, split_dataset
from ml.training import TrainingConfig, TrainingError, train


def _emit(value: Any, out: str | None) -> None:
    text = json.dumps(value, indent=2, sort_keys=True)
    if out:
        Path(out).write_text(text + "\n")
        print(f"wrote {out}")
    else:
        print(text)


def _split_config(path: str | None) -> SplitConfig:
    return SplitConfig.from_json(json.loads(Path(path).read_text())) if path else SplitConfig()


def registration_body(artifact: Path) -> dict[str, Any]:
    """The JSON an administrator POSTs to register this artifact. Built from the
    manifest the training run wrote — never typed by hand."""
    manifest = json.loads((artifact / "manifest.json").read_text())
    return {
        "task": manifest["task"].upper(),
        "version": manifest["version"],
        "modelFormat": manifest["modelFormat"],
        "artifactUri": f"{manifest['task']}/{manifest['version']}",
        "artifactSha256": manifest["artifact"]["sha256"],
        "featureSchemaVersion": manifest["featureSchemaVersion"],
        "labelSchemaVersion": manifest["labelSchemaVersion"],
        "datasetName": manifest["dataset"]["name"],
        "datasetVersion": manifest["dataset"]["version"],
        "datasetFingerprint": manifest["dataset"]["fingerprint"],
        "syntheticData": manifest["dataset"]["synthetic"],
        "trainingConfig": manifest["config"],
        "codeRevision": (manifest.get("codeRevision") or {}).get("commit"),
        "trainedAt": manifest["trainedAt"],
        "metrics": manifest["metrics"],
        "evaluationDatasetVersion": manifest["evaluationDataset"]["version"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m ml")
    sub = parser.add_subparsers(dest="command", required=True)
    v = sub.add_parser("validate")
    v.add_argument("--dataset", required=True)
    v.add_argument("--out")
    s = sub.add_parser("split")
    s.add_argument("--dataset", required=True)
    s.add_argument("--config")
    s.add_argument("--out")
    e = sub.add_parser("evaluate")
    e.add_argument("--dataset", required=True)
    e.add_argument("--split", choices=["test"])
    e.add_argument("--config")
    e.add_argument("--k", default="1,3,5,10")
    e.add_argument("--duplicate-threshold", type=float, default=0.65)
    e.add_argument("--out")
    t = sub.add_parser("train")
    t.add_argument("--config", required=True)
    t.add_argument("--out")
    r = sub.add_parser("registration")
    r.add_argument("--artifact", required=True)
    r.add_argument("--out")
    args = parser.parse_args(argv)

    try:
        if args.command == "validate":
            dataset = load_dataset(args.dataset)
            _emit(
                {
                    "dataset": dataset.manifest.model_dump(mode="json"),
                    "fingerprint": dataset.fingerprint,
                    "report": dataset.report.to_json(),
                },
                args.out,
            )
            return 1 if dataset.report.invalid else 0
        if args.command == "split":
            dataset = load_dataset(args.dataset)
            split = split_dataset(dataset, _split_config(args.config))
            _emit(split.report, args.out)
            return 0
        if args.command == "evaluate":
            dataset = load_dataset(args.dataset)
            records = dataset.records
            if args.split:
                records = split_dataset(
                    dataset, _split_config(args.config), check_classes=False
                ).test
            ks = tuple(int(k) for k in args.k.split(","))
            report = evaluate_records(
                dataset, records, ks=ks, duplicate_threshold=args.duplicate_threshold
            )
            report["scope"] = args.split or "all"
            _emit(report, args.out)
            return 0
        if args.command == "train":
            result = train(TrainingConfig.from_file(args.config))
            _emit(result, args.out)
            return 0
        if args.command == "registration":
            _emit(registration_body(Path(args.artifact)), args.out)
            return 0
    except InsufficientDataError as error:
        _emit({"error": "INSUFFICIENT_DATA", "reasons": error.reasons}, None)
        return 1
    except (DatasetError, TrainingError, EvaluationError) as error:
        _emit({"error": type(error).__name__, "message": str(error)}, None)
        return 1
    return 2


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
