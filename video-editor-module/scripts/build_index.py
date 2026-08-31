#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


TARGETS = {"macos-arm64", "macos-x86_64", "windows-x86_64"}
VERSION_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.+-]{0,62}[A-Za-z0-9])?$")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--allow-internal", action="store_true")
    parser.add_argument("packages", type=Path, nargs="+")
    args = parser.parse_args()
    if not VERSION_PATTERN.fullmatch(args.version) or ".." in args.version:
        raise SystemExit("invalid module version")
    packages = {}
    for path in args.packages:
        document = json.loads(path.read_text(encoding="utf-8"))
        target = document.get("target")
        if target not in TARGETS or target in packages:
            raise SystemExit(f"cannot uniquely infer target from {path}")
        if document.get("version") != args.version:
            raise SystemExit(f"package version mismatch: {path}")
        if document.get("size", 0) <= 0 or len(document.get("sha256", "")) != 64:
            raise SystemExit(f"invalid package document: {path}")
        if not document.get("releaseEligible", False) and not args.allow_internal:
            raise SystemExit(f"package is not eligible for public release: {path}")
        packages[target] = {
            "url": document["url"],
            "sha256": document["sha256"],
            "size": document["size"],
        }
    missing = TARGETS - packages.keys()
    if missing:
        raise SystemExit(f"missing target packages: {', '.join(sorted(missing))}")
    index = {
        "schemaVersion": 1,
        "version": args.version,
        "debugOnly": bool(args.allow_internal),
        "packages": packages,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
