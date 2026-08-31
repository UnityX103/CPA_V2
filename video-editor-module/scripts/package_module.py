#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


TARGETS = {"macos-arm64", "macos-x86_64", "windows-x86_64"}
DISTRIBUTIONS = {"commercial", "noncommercial-open-source", "internal-poc"}
CAPABILITIES = [
    "sam2-birefnet-v1",
    "screenshot",
    "output-resolution",
    "vp8-alpha-webm",
]
VERSION_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.+-]{0,62}[A-Za-z0-9])?$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--licenses", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--release-url", required=True)
    parser.add_argument("--distribution", choices=sorted(DISTRIBUTIONS), default="commercial")
    parser.add_argument("--allow-uncleared-birefnet", action="store_true")
    parser.add_argument("--allow-unsigned-runtime", action="store_true")
    args = parser.parse_args()
    if not VERSION_PATTERN.fullmatch(args.version) or ".." in args.version:
        raise SystemExit("invalid module version")

    project_root = Path(__file__).resolve().parents[1]
    policy = json.loads((project_root / "source-policy.json").read_text(encoding="utf-8"))
    distribution = "internal-poc" if args.allow_uncleared_birefnet else args.distribution
    allowed = {
        "commercial": policy["commercialReleaseAllowed"],
        "noncommercial-open-source": policy["nonCommercialOpenSourceReleaseAllowed"],
        "internal-poc": True,
    }[distribution]
    if not allowed:
        raise SystemExit(policy["commercialReleaseBlocker"])
    if args.allow_unsigned_runtime and distribution != "internal-poc":
        raise SystemExit("unsigned runtimes are allowed only for explicitly internal PoC packages")
    validate_runtime(
        args.runtime,
        args.target,
        policy,
        args.allow_unsigned_runtime,
        distribution,
    )
    if not args.licenses.is_dir() or not any(args.licenses.iterdir()):
        raise SystemExit("license pack is empty")
    if distribution == "noncommercial-open-source" and not (
        args.licenses / "NONCOMMERCIAL-NOTICE.md"
    ).is_file():
        raise SystemExit("non-commercial release is missing NONCOMMERCIAL-NOTICE.md")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    archive_name = f"video-editor-module-{args.version}-{args.target}.zip"
    archive_path = args.output_dir / archive_name
    with tempfile.TemporaryDirectory(prefix="cpa-video-module-stage-") as temporary:
        staging = Path(temporary)
        shutil.copytree(args.runtime, staging / "runtime")
        shutil.copytree(args.licenses, staging / "licenses")
        manifest = {
            "schemaVersion": 1,
            "id": "cpa-video-editor",
            "version": args.version,
            "target": args.target,
            "entry": entry_path(args.target),
            "capabilities": CAPABILITIES,
            "distribution": distribution,
        }
        (staging / "module.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        runtime_manifest = {
            "schemaVersion": 1,
            "target": args.target,
            "pipeline": policy["pipeline"],
            "commercialReleaseAllowed": policy["commercialReleaseAllowed"],
            "distribution": distribution,
            "unsignedInternalRuntime": args.allow_unsigned_runtime,
            "files": tree_hashes(staging / "runtime"),
        }
        (staging / "runtime-manifest.json").write_text(
            json.dumps(runtime_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        write_zip(staging, archive_path)

    package = {
        "target": args.target,
        "version": args.version,
        "distribution": distribution,
        "url": args.release_url.rstrip("/") + "/" + archive_name,
        "sha256": sha256(archive_path),
        "size": archive_path.stat().st_size,
        "releaseEligible": bool(allowed and distribution != "internal-poc"),
    }
    (archive_path.with_suffix(".package.json")).write_text(
        json.dumps(package, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(archive_path)
    print(json.dumps(package, separators=(",", ":")))


def entry_path(target: str) -> str:
    suffix = ".exe" if target == "windows-x86_64" else ""
    return f"runtime/video-editor-module{suffix}"


def validate_runtime(
    runtime: Path,
    target: str,
    policy: dict,
    allow_unsigned: bool,
    distribution: str,
) -> None:
    entry = runtime / Path(entry_path(target)).name
    ffmpeg = runtime / "bin" / ("ffmpeg.exe" if target == "windows-x86_64" else "ffmpeg")
    ffprobe = runtime / "bin" / ("ffprobe.exe" if target == "windows-x86_64" else "ffprobe")
    sam = runtime / "models" / "sam2" / policy["components"]["sam2"]["checkpoint"]
    biref = runtime / "models" / "birefnet" / "model.safetensors"
    for path in [entry, ffmpeg, ffprobe, sam, biref]:
        if not path.is_file():
            raise SystemExit(f"missing runtime file: {path}")
    if sha256(sam) != policy["components"]["sam2"]["checkpointSha256"]:
        raise SystemExit("SAM2 checkpoint hash mismatch")
    if sha256(biref) != policy["components"]["birefnet"]["modelSha256"]:
        raise SystemExit("BiRefNet checkpoint hash mismatch")
    if not allow_unsigned:
        validate_platform_signature(entry, target, distribution)
    buildconf = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-buildconf"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=True,
    ).stdout
    for flag in policy["components"]["ffmpeg"]["forbiddenConfigureFlags"]:
        if flag in buildconf:
            raise SystemExit(f"forbidden FFmpeg flag: {flag}")
    encoders = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-encoders"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=True,
    ).stdout
    required_encoders = list(policy["components"]["ffmpeg"]["requiredEncoders"])
    if target.startswith("macos-"):
        required_encoders += policy["components"]["ffmpeg"]["macosRequiredEncoders"]
    for encoder in required_encoders:
        if encoder not in encoders:
            raise SystemExit(f"FFmpeg is missing {encoder}")


def validate_platform_signature(entry: Path, target: str, distribution: str) -> None:
    if target.startswith("macos-"):
        if sys.platform != "darwin":
            raise SystemExit("macOS runtime signatures must be verified on macOS")
        subprocess.run(
            ["codesign", "--verify", "--deep", "--strict", str(entry)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        details = subprocess.run(
            ["codesign", "-dv", "--verbose=4", str(entry)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        ).stdout
        if distribution == "commercial" and "Authority=Developer ID Application:" not in details:
            raise SystemExit("macOS runtime is not Developer ID signed")
        return
    if target == "windows-x86_64":
        if distribution == "noncommercial-open-source":
            return
        if os.name != "nt":
            raise SystemExit("Windows runtime signatures must be verified on Windows")
        script = (
            "& { param([string]$p) "
            "(Get-AuthenticodeSignature -LiteralPath $p).Status.ToString() }"
        )
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script, str(entry)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        ).stdout.strip()
        if result != "Valid":
            raise SystemExit(f"Windows runtime Authenticode status is {result or 'missing'}")


def tree_hashes(root: Path) -> list[dict[str, object]]:
    files = []
    for path in sorted(value for value in root.rglob("*") if value.is_file()):
        files.append({
            "path": path.relative_to(root).as_posix(),
            "size": path.stat().st_size,
            "sha256": sha256(path),
        })
    return files


def write_zip(root: Path, output: Path) -> None:
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            archive.write(path, relative)


if __name__ == "__main__":
    main()
