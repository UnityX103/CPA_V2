#!/usr/bin/env python3
"""Compose one shared CockroachPet logic package with three reusable runtimes."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


TARGETS = {"macos-arm64", "macos-x86_64", "windows-x86_64"}
COMPONENTS = {"runtime", "dependencies", "logic"}
DISTRIBUTION = "noncommercial-open-source"


def validate_component(document: dict) -> None:
    if document.get("component") not in COMPONENTS:
        raise ValueError("invalid Cockroach component type")
    if document.get("distribution") != DISTRIBUTION:
        raise ValueError("Cockroach components must use the noncommercial distribution")
    if not document.get("releaseEligible"):
        raise ValueError("Cockroach component is not eligible for release")
    if document.get("packageAuthenticity") != "tauri-minisign-index+sha256":
        raise ValueError("Cockroach component lacks signed-index authenticity")
    if not document.get("publicIndexSignatureRequired"):
        raise ValueError("Cockroach component must require a signed public index")
    for field in ["version", "url", "runtimeAbi", "manifestSha256", "sha256"]:
        if not isinstance(document.get(field), str) or not document[field]:
            raise ValueError(f"Cockroach component is missing {field}")
    for field in ["manifestSha256", "sha256"]:
        if len(document[field]) != 64 or not all(value in "0123456789abcdefABCDEF" for value in document[field]):
            raise ValueError(f"Cockroach component has an invalid {field}")
    if not isinstance(document.get("size"), int) or document["size"] <= 0:
        raise ValueError("Cockroach component has an invalid size")
    if document.get("component") == "runtime" and not document.get("acceptanceReceiptSha256"):
        raise ValueError("Cockroach runtime lacks a target acceptance receipt")


def package_entry(document: dict) -> dict:
    result = {
        "version": document["version"],
        "url": document["url"],
        "sha256": document["sha256"],
        "size": document["size"],
        "manifestSha256": document["manifestSha256"],
        "runtimeAbi": document["runtimeAbi"],
    }
    if document.get("platformSignature"):
        result["platformSignature"] = document["platformSignature"]
    if document.get("dependencySet"):
        result["dependencySet"] = document["dependencySet"]
    if document.get("acceptanceReceiptSha256"):
        result["acceptanceReceiptSha256"] = document["acceptanceReceiptSha256"]
    if document.get("mirrors"):
        result["mirrors"] = document["mirrors"]
    return result


def build_index(version: str, documents: list[dict]) -> dict:
    logic = None
    dependencies = None
    runtimes = {}
    for document in documents:
        validate_component(document)
        if document["component"] == "logic":
            if logic is not None:
                raise ValueError("duplicate Cockroach logic component")
            logic = package_entry(document)
            continue
        if document["component"] == "dependencies":
            if dependencies is not None:
                raise ValueError("duplicate Cockroach dependencies component")
            dependencies = package_entry(document)
            continue
        target = document.get("target")
        if target not in TARGETS or target in runtimes:
            raise ValueError("Cockroach runtime target is missing or duplicated")
        runtimes[target] = package_entry(document)
    if logic is None or dependencies is None:
        raise ValueError("Cockroach logic or dependencies component is missing")
    missing = TARGETS - runtimes.keys()
    if missing:
        raise ValueError("missing Cockroach runtimes: " + ", ".join(sorted(missing)))
    if logic["version"] != version:
        raise ValueError("index version must equal Cockroach logic version")
    if any(runtime["runtimeAbi"] != logic["runtimeAbi"] for runtime in runtimes.values()):
        raise ValueError("Cockroach runtime and logic ABI values do not match")
    if dependencies.get("dependencySet") != logic.get("dependencySet"):
        raise ValueError("Cockroach dependencies and logic dependencySet values do not match")
    return {
        "schemaVersion": 2,
        "version": version,
        "debugOnly": False,
        "distribution": DISTRIBUTION,
        "packageAuthenticity": "tauri-minisign-index+sha256",
        "logic": logic,
        "dependencies": dependencies,
        "runtimes": runtimes,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("components", type=Path, nargs="+")
    args = parser.parse_args()
    documents = [json.loads(path.read_text(encoding="utf-8")) for path in args.components]
    index = build_index(args.version, documents)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
