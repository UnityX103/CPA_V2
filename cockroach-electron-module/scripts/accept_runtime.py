#!/usr/bin/env python3
"""Promote a runtime component only after a target smoke-test receipt matches it."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import package_layers as layers


REQUIRED_CHECKS = {
    "macos-arm64": {"allMachOThin", "codesignValid", "versionLaunch", "logicLaunch"},
    "macos-x86_64": {"allMachOThin", "codesignValid", "versionLaunch", "logicLaunch"},
    "windows-x86_64": {"peX86_64", "versionLaunch", "logicLaunch"},
}


def accept_runtime(component_path: Path, archive_path: Path, receipt_path: Path) -> dict:
    component = json.loads(component_path.read_text(encoding="utf-8"))
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if component.get("component") != "runtime" or component.get("target") not in REQUIRED_CHECKS:
        raise ValueError("acceptance target is not a supported Cockroach runtime")
    if layers.sha256(archive_path) != component.get("sha256") or archive_path.stat().st_size != component.get("size"):
        raise ValueError("acceptance archive does not match the runtime component document")
    expected = {
        "schemaVersion": 1,
        "component": "runtime",
        "target": component["target"],
        "version": component["version"],
        "runtimeAbi": component["runtimeAbi"],
        "artifactSha256": component["sha256"],
    }
    if any(receipt.get(key) != value for key, value in expected.items()):
        raise ValueError("runtime acceptance receipt does not match the component")
    checks = receipt.get("checks")
    required = REQUIRED_CHECKS[component["target"]]
    if not isinstance(checks, dict) or any(checks.get(name) is not True for name in required):
        raise ValueError("runtime acceptance receipt is missing required passing checks")
    component["releaseEligible"] = True
    component["acceptanceReceiptSha256"] = layers.sha256(receipt_path)
    component["acceptanceChecks"] = sorted(required)
    layers.write_json(component_path, component)
    return component


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--component", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(accept_runtime(args.component, args.archive, args.receipt), separators=(",", ":")))


if __name__ == "__main__":
    main()
