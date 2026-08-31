#!/usr/bin/env python3
"""Package a pinned, unpacked CockroachPet Electron runtime for CPA."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

MODULE_ID = "cpa-cockroach-electron"
UPSTREAM_COMMIT = "a7d103d2818b40e12b8a39948e9ebf4c6085bfd3"
CAPABILITIES = [
    "electron-vector-cockroach-v1",
    "max-count",
    "baby-growth-minutes",
    "process-lifecycle",
    "process-control-file-v1",
]
TARGETS = {"macos-arm64", "macos-x86_64", "windows-x86_64"}
ROOT = Path(__file__).resolve().parents[1]
PATCHED_SOURCE_HASHES = {
    "main.js": "36d78c0ad637b19f470b7001ffb83770c1f4aa018b160711461c683bacf653ee",
    "src/overlay/overlay.js": "9879f7e4d059cbf379ab98eb3b5bfd9a4a6629e39c17aaa9065d5c5894fb1431",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-dir", type=Path, required=True)
    parser.add_argument("--source-dir", type=Path, required=True)
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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_patched_source(source_dir: Path) -> None:
    source_dir = source_dir.resolve()
    commit = subprocess.check_output(
        ["git", "-C", str(source_dir), "rev-parse", "HEAD"],
        text=True,
    ).strip()
    if commit != UPSTREAM_COMMIT:
        raise ValueError(f"upstream commit must be {UPSTREAM_COMMIT}, got {commit}")
    status = set(filter(None, subprocess.check_output(
        ["git", "-C", str(source_dir), "status", "--porcelain", "--untracked-files=all"],
        text=True,
    ).splitlines()))
    expected_status = {" M main.js", " M src/overlay/overlay.js"}
    if status != expected_status:
        raise ValueError(f"upstream worktree does not match the reviewed adapter: {sorted(status)}")
    for relative, expected_hash in PATCHED_SOURCE_HASHES.items():
        path = source_dir / relative
        if not path.is_file() or sha256_file(path) != expected_hash:
            raise ValueError(f"upstream source does not match the reviewed adapter: {relative}")


def verify_packaged_runtime(runtime_dir: Path, source_dir: Path, target: str) -> None:
    source_dir = source_dir.resolve()
    runtime_dir = runtime_dir.resolve()
    try:
        runtime_dir.relative_to((source_dir / "dist").resolve())
    except ValueError as error:
        raise ValueError("runtime directory must be built inside the verified source dist/") from error
    app_asar = (
        runtime_dir / "Contents" / "Resources" / "app.asar"
        if target.startswith("macos-")
        else runtime_dir / "resources" / "app.asar"
    )
    asar_script = source_dir / "node_modules" / "@electron" / "asar" / "bin" / "asar.js"
    node = shutil.which("node")
    if not app_asar.is_file() or not asar_script.is_file() or not node:
        raise ValueError("packaged runtime cannot be inspected; build it after npm install")
    with tempfile.TemporaryDirectory(prefix="cpa-cockroach-asar-") as temporary:
        extracted = Path(temporary)
        try:
            subprocess.run(
                [node, str(asar_script), "extract", str(app_asar), str(extracted)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
        except subprocess.CalledProcessError as error:
            raise ValueError(f"unable to inspect packaged app.asar: {error.stderr}") from error
        for relative, expected_hash in PATCHED_SOURCE_HASHES.items():
            path = extracted / relative
            if not path.is_file() or sha256_file(path) != expected_hash:
                raise ValueError(f"packaged app.asar does not contain the reviewed adapter: {relative}")


def package(
    runtime_dir: Path,
    source_dir: Path,
    entry: str,
    target: str,
    version: str,
    output_dir: Path,
) -> Path:
    runtime_dir = runtime_dir.resolve()
    if not runtime_dir.is_dir():
        raise ValueError(f"runtime directory does not exist: {runtime_dir}")
    entry_path = validate_relative_entry(entry)
    if not version or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-+" for character in version):
        raise ValueError("version contains unsupported characters")
    if target not in TARGETS:
        raise ValueError(f"unsupported target: {target}")
    verify_patched_source(source_dir)
    verify_packaged_runtime(runtime_dir, source_dir, target)

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
                "commit": UPSTREAM_COMMIT,
                "integrationPatch": "cpa-control-file-v1",
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
    print(package(
        args.runtime_dir,
        args.source_dir,
        args.entry,
        args.target,
        args.version,
        args.output_dir,
    ))


if __name__ == "__main__":
    main()
