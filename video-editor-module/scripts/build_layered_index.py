#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


TARGETS = {"macos-arm64", "macos-x86_64", "windows-x86_64"}
COMPONENTS = {"engine", "models", "logic"}
VERSION_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.+-]{0,62}[A-Za-z0-9])?$")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True, help="active logic/UI version")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--allow-internal", action="store_true")
    parser.add_argument("components", type=Path, nargs="+")
    args = parser.parse_args()
    validate_version(args.version)

    engines: dict[str, dict] = {}
    common: dict[str, dict] = {}
    distributions: set[str] = set()
    for path in args.components:
        document = json.loads(path.read_text(encoding="utf-8"))
        component = document.get("component")
        if component not in COMPONENTS:
            raise SystemExit(f"invalid component document: {path}")
        validate_component_document(document, path, args.allow_internal)
        distributions.add(document["distribution"])
        package = package_entry(document)
        if component == "engine":
            target = document.get("target")
            if target not in TARGETS or target in engines:
                raise SystemExit(f"cannot uniquely infer engine target from {path}")
            engines[target] = package
        else:
            if component in common:
                raise SystemExit(f"duplicate {component} component: {path}")
            common[component] = package

    missing_targets = TARGETS - engines.keys()
    if missing_targets:
        raise SystemExit(f"missing engine targets: {', '.join(sorted(missing_targets))}")
    missing_components = {"logic", "models"} - common.keys()
    if missing_components:
        raise SystemExit(f"missing common components: {', '.join(sorted(missing_components))}")
    if common["logic"]["version"] != args.version:
        raise SystemExit("index version must equal the logic component version")
    engine_abi = common["logic"]["engineAbi"]
    model_set = common["logic"]["modelSet"]
    if common["models"]["modelSet"] != model_set:
        raise SystemExit("logic and models modelSet values do not match")
    if any(engine["engineAbi"] != engine_abi for engine in engines.values()):
        raise SystemExit("logic and engine engineAbi values do not match")
    if len(distributions) != 1:
        raise SystemExit("all layered components must use the same distribution policy")
    index = {
        "schemaVersion": 2,
        "version": args.version,
        "debugOnly": bool(args.allow_internal),
        "distribution": distributions.pop(),
        "packageAuthenticity": "tauri-minisign-index+sha256",
        "logic": common["logic"],
        "models": common["models"],
        "engines": engines,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(args.output)


def validate_component_document(document: dict, path: Path, allow_internal: bool) -> None:
    validate_version(document.get("version"))
    if document.get("size", 0) <= 0:
        raise SystemExit(f"invalid component size: {path}")
    digest = document.get("sha256", "")
    if len(digest) != 64 or not all(character in "0123456789abcdefABCDEF" for character in digest):
        raise SystemExit(f"invalid component hash: {path}")
    manifest_digest = document.get("manifestSha256", "")
    if len(manifest_digest) != 64 or not all(
        character in "0123456789abcdefABCDEF" for character in manifest_digest
    ):
        raise SystemExit(f"invalid component manifest hash: {path}")
    if not isinstance(document.get("url"), str) or not document["url"]:
        raise SystemExit(f"component URL is missing: {path}")
    if not document.get("releaseEligible", False) and not allow_internal:
        raise SystemExit(f"component is not eligible for public release: {path}")
    if not allow_internal:
        if document.get("packageAuthenticity") != "tauri-minisign-index+sha256":
            raise SystemExit(f"component lacks signed-index authenticity policy: {path}")
        if not document.get("publicIndexSignatureRequired"):
            raise SystemExit(f"component does not require a signed public index: {path}")
    if not document.get("distribution"):
        raise SystemExit(f"component distribution is missing: {path}")
    if document.get("component") == "engine" and not document.get("platformSignature"):
        raise SystemExit(f"engine signature metadata is missing: {path}")
    component = document.get("component")
    if component in {"engine", "logic"} and not document.get("engineAbi"):
        raise SystemExit(f"component engineAbi is missing: {path}")
    if component in {"models", "logic"} and not document.get("modelSet"):
        raise SystemExit(f"component modelSet is missing: {path}")


def package_entry(document: dict) -> dict:
    entry = {
        "version": document["version"],
        "url": document["url"],
        "sha256": document["sha256"],
        "size": document["size"],
    }
    for field in [
        "mirrors",
        "platformSignature",
        "engineAbi",
        "modelSet",
        "manifestSha256",
    ]:
        if document.get(field):
            entry[field] = document[field]
    return entry


def validate_version(value: object) -> None:
    if not isinstance(value, str) or not VERSION_PATTERN.fullmatch(value) or ".." in value:
        raise SystemExit("invalid component version")


if __name__ == "__main__":
    main()
