#!/usr/bin/env python3
"""Package a pinned, unpacked CockroachPet Electron runtime for CPA."""

from __future__ import annotations

import argparse
import json
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

MODULE_ID = "cpa-cockroach-electron"
CAPABILITIES = [
    "electron-vector-cockroach-v1",
    "max-count",
    "baby-growth-minutes",
    "process-lifecycle",
]
TARGETS = {"macos-arm64", "macos-x86_64", "windows-x86_64"}
ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-dir", type=Path, required=True)
    parser.add_argument("--entry", required=True)
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def validate_relative_entry(entry: str) -> PurePosixPath:
    value = PurePosixPath(entry)
    if value.is_absolute() or ".." in value.parts or not value.parts or value.parts[0] != "runtime":
        raise ValueError("entry must be a safe path below runtime/")
    return value


def package(runtime_dir: Path, entry: str, target: str, version: str, output_dir: Path) -> Path:
    runtime_dir = runtime_dir.resolve()
    if not runtime_dir.is_dir():
        raise ValueError(f"runtime directory does not exist: {runtime_dir}")
    entry_path = validate_relative_entry(entry)
    if not version or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-+" for character in version):
        raise ValueError("version contains unsupported characters")
    if target not in TARGETS:
        raise ValueError(f"unsupported target: {target}")

    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / f"cockroach-module-{version}-{target}.zip"
    with tempfile.TemporaryDirectory(prefix="cpa-cockroach-module-") as temporary:
        staging = Path(temporary)
        copied_runtime = staging / "runtime" / runtime_dir.name
        shutil.copytree(runtime_dir, copied_runtime, symlinks=False)
        executable = staging.joinpath(*entry_path.parts)
        if not executable.is_file():
            raise ValueError(f"entry does not exist in staged runtime: {entry}")
        executable.chmod(executable.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        (staging / "licenses").mkdir()
        shutil.copy2(ROOT / "UPSTREAM_LICENSE", staging / "licenses" / "CockroachPet-MIT.txt")
        manifest = {
            "schemaVersion": 1,
            "id": MODULE_ID,
            "version": version,
            "target": target,
            "entry": entry,
            "capabilities": CAPABILITIES,
            "upstream": {
                "repository": "https://github.com/jo9900/CockroachPet-Public-Electron",
                "commit": "a7d103d2818b40e12b8a39948e9ebf4c6085bfd3",
            },
        }
        (staging / "module.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(staging.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(staging).as_posix())
    return destination


def main() -> None:
    args = parse_args()
    print(package(args.runtime_dir, args.entry, args.target, args.version, args.output_dir))


if __name__ == "__main__":
    main()
