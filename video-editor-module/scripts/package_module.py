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
from dataclasses import dataclass
from pathlib import Path

from windows_runtime import validate_windows_runtime


TARGETS = {"macos-arm64", "macos-x86_64", "windows-x86_64"}
@dataclass(frozen=True)
class DistributionPolicy:
    release_allowed_key: str | None
    requires_noncommercial_notice: bool
    requires_public_index_signature: bool
    macos_signature: str
    windows_signature: str


DISTRIBUTION_POLICIES = {
    "commercial": DistributionPolicy(
        release_allowed_key="commercialReleaseAllowed",
        requires_noncommercial_notice=False,
        requires_public_index_signature=True,
        macos_signature="developer-id",
        windows_signature="authenticode",
    ),
    "noncommercial-open-source": DistributionPolicy(
        release_allowed_key="nonCommercialOpenSourceReleaseAllowed",
        requires_noncommercial_notice=True,
        requires_public_index_signature=True,
        macos_signature="valid-codesign",
        # This distribution explicitly permits an unsigned Windows executable.
        # Authenticity instead comes from the Tauri-signed index and package SHA-256.
        windows_signature="authenticode-or-signed-index",
    ),
    "internal-poc": DistributionPolicy(
        release_allowed_key=None,
        requires_noncommercial_notice=False,
        requires_public_index_signature=False,
        macos_signature="optional",
        windows_signature="optional",
    ),
}
DISTRIBUTIONS = set(DISTRIBUTION_POLICIES)
VERSION_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.+-]{0,62}[A-Za-z0-9])?$")
PACKAGE_NAME_SEPARATOR = re.compile(r"[-_.]+")


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
    contract = json.loads((project_root / "module-contract.json").read_text(encoding="utf-8"))
    if policy["pipeline"] != contract["pipeline"]:
        raise SystemExit("module contract and source policy pipeline mismatch")
    distribution = "internal-poc" if args.allow_uncleared_birefnet else args.distribution
    distribution_policy = DISTRIBUTION_POLICIES[distribution]
    allowed = (
        True
        if distribution_policy.release_allowed_key is None
        else policy[distribution_policy.release_allowed_key]
    )
    if not allowed:
        raise SystemExit(policy["commercialReleaseBlocker"])
    if args.allow_unsigned_runtime and distribution != "internal-poc":
        raise SystemExit("unsigned runtimes are allowed only for explicitly internal PoC packages")
    platform_signature, runtime_build_configuration = validate_runtime(
        args.runtime,
        args.target,
        policy,
        args.allow_unsigned_runtime,
        distribution,
    )
    source_manifest = validate_license_pack(
        args.licenses,
        args.target,
        distribution_policy,
        policy,
        runtime_build_configuration,
        required_python_packages(project_root, args.target),
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    archive_name = f"video-editor-module-{args.version}-{args.target}.zip"
    archive_path = args.output_dir / archive_name
    with tempfile.TemporaryDirectory(prefix="cpa-video-module-stage-") as temporary:
        staging = Path(temporary)
        shutil.copytree(args.runtime, staging / "runtime")
        shutil.copytree(args.licenses, staging / "licenses")
        shutil.copy2(args.licenses / "SOURCE-MANIFEST.json", staging / "source-manifest.json")
        manifest = {
            "schemaVersion": contract["schemaVersion"],
            "id": contract["id"],
            "version": args.version,
            "target": args.target,
            "entry": entry_path(args.target),
            "capabilities": contract["capabilities"],
            "distribution": distribution,
        }
        (staging / "module.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        runtime_manifest = {
            "schemaVersion": 1,
            "target": args.target,
            "pipeline": contract["pipeline"],
            "commercialReleaseAllowed": policy["commercialReleaseAllowed"],
            "distribution": distribution,
            "platformSignature": platform_signature,
            "packageAuthenticity": "tauri-minisign-index+sha256",
            "publicIndexSignatureRequired": distribution_policy.requires_public_index_signature,
            "sourceProvenance": source_manifest,
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
        "platformSignature": platform_signature,
        "packageAuthenticity": "tauri-minisign-index+sha256",
        "publicIndexSignatureRequired": distribution_policy.requires_public_index_signature,
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
) -> tuple[str, str]:
    if target == "windows-x86_64":
        validate_windows_runtime(runtime)
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
    platform_signature = (
        "unsigned-internal-poc"
        if allow_unsigned
        else validate_platform_signature(entry, target, distribution)
    )
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
    return platform_signature, buildconf


def validate_platform_signature(entry: Path, target: str, distribution: str) -> str:
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
        if "Authority=Developer ID Application:" in details:
            return "developer-id"
        return "ad-hoc"
    if target == "windows-x86_64":
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
        if result == "Valid":
            return "authenticode-valid"
        if distribution == "noncommercial-open-source" and result == "NotSigned":
            return "unsigned-index-authenticated"
        if result != "Valid":
            raise SystemExit(f"Windows runtime Authenticode status is {result or 'missing'}")
    raise SystemExit(f"unsupported target signature policy: {target}")


def validate_license_pack(
    licenses: Path,
    target: str,
    distribution_policy: DistributionPolicy,
    source_policy: dict,
    runtime_build_configuration: str,
    required_packages: set[str],
) -> dict:
    required = {
        "THIRD-PARTY-SOURCES.md",
        "PYTHON-LICENSE.txt",
        "PYTHON-PACKAGE-LICENSES.json",
        "FFMPEG-LICENSE.txt",
        "FFMPEG-CONFIGURATION.txt",
        "LIBVPX-LICENSE.txt",
        "LIBVPX-PATENTS.txt",
        "SOURCE-MANIFEST.json",
    }
    if distribution_policy.requires_noncommercial_notice:
        required.add("NONCOMMERCIAL-NOTICE.md")
    missing = sorted(name for name in required if not (licenses / name).is_file())
    if missing:
        raise SystemExit(f"license pack is missing required files: {', '.join(missing)}")

    try:
        python_licenses = json.loads(
            (licenses / "PYTHON-PACKAGE-LICENSES.json").read_text(encoding="utf-8")
        )
        source_manifest = json.loads(
            (licenses / "SOURCE-MANIFEST.json").read_text(encoding="utf-8")
        )
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise SystemExit(f"invalid license metadata: {error}") from error
    if not isinstance(python_licenses, list) or not python_licenses:
        raise SystemExit("PYTHON-PACKAGE-LICENSES.json must contain at least one package")
    for package in python_licenses:
        if not isinstance(package, dict) or not all(
            isinstance(package.get(field), str) and package[field].strip()
            for field in ("Name", "Version", "License")
        ):
            raise SystemExit("Python package license entries require Name, Version, and License")
    inventoried_packages = {
        normalize_package_name(package["Name"])
        for package in python_licenses
    }
    missing_packages = sorted(required_packages - inventoried_packages)
    if missing_packages:
        raise SystemExit(
            "Python package license inventory is missing: " + ", ".join(missing_packages)
        )
    if source_manifest.get("target") != target:
        raise SystemExit("SOURCE-MANIFEST.json target does not match package target")
    components = source_manifest.get("components")
    required_components = {"sam2", "birefnet", "ffmpeg", "libvpx", "python"}
    if not isinstance(components, dict) or not required_components.issubset(components):
        raise SystemExit("SOURCE-MANIFEST.json is missing component provenance")
    if not source_manifest.get("sourceCommit"):
        raise SystemExit("SOURCE-MANIFEST.json is missing sourceCommit")
    if not re.fullmatch(r"[0-9a-f]{40}", source_manifest["sourceCommit"]):
        raise SystemExit("SOURCE-MANIFEST.json sourceCommit must be a full Git commit")

    policy_components = source_policy["components"]
    sam = components["sam2"]
    require_exact_fields(
        sam,
        policy_components["sam2"],
        ("repository", "commit", "checkpointUrl", "checkpointSha256", "license"),
        "SAM2",
    )
    birefnet = components["birefnet"]
    require_exact_fields(
        birefnet,
        policy_components["birefnet"],
        (
            "repository",
            "commit",
            "modelRepository",
            "modelRevision",
            "modelSha256",
            "declaredLicense",
        ),
        "BiRefNet",
    )

    ffmpeg_policy = policy_components["ffmpeg"]
    ffmpeg = components["ffmpeg"]
    libvpx = components["libvpx"]
    if target.startswith("macos-"):
        macos_source = ffmpeg_policy["macosSource"]
        require_exact_fields(ffmpeg, macos_source, ("version", "url", "sha256"), "FFmpeg")
        require_exact_fields(
            libvpx,
            {
                "version": macos_source["libvpxVersion"],
                "url": macos_source["libvpxUrl"],
                "sha256": macos_source["libvpxSha256"],
            },
            ("version", "url", "sha256"),
            "libvpx",
        )
    else:
        windows_source = ffmpeg_policy["windowsBuild"]
        require_exact_fields(
            ffmpeg,
            {
                "provider": windows_source["provider"],
                "asset": windows_source["asset"],
                "url": windows_source["url"],
                "sha256": windows_source["sha256"],
                "commit": windows_source["ffmpegCommit"],
                "buildRepository": windows_source["buildRepository"],
                "buildCommit": windows_source["buildCommit"],
                "buildSourceUrl": windows_source["buildSourceUrl"],
                "buildSourceSha256": windows_source["buildSourceSha256"],
                "sourceUrl": windows_source["ffmpegSourceUrl"],
                "sourceSha256": windows_source["ffmpegSourceSha256"],
            },
            (
                "provider",
                "asset",
                "url",
                "sha256",
                "commit",
                "buildRepository",
                "buildCommit",
                "buildSourceUrl",
                "buildSourceSha256",
                "sourceUrl",
                "sourceSha256",
            ),
            "Windows FFmpeg",
        )
        require_exact_fields(
            libvpx,
            {
                "repository": windows_source["libvpxRepository"],
                "commit": windows_source["libvpxCommit"],
                "sourceUrl": windows_source["libvpxSourceUrl"],
                "sourceSha256": windows_source["libvpxSourceSha256"],
            },
            ("repository", "commit", "sourceUrl", "sourceSha256"),
            "Windows libvpx",
        )

    availability = source_manifest.get("sourceAvailability")
    assets = availability.get("assets") if isinstance(availability, dict) else None
    if not isinstance(assets, list):
        raise SystemExit("SOURCE-MANIFEST.json is missing corresponding-source assets")
    actual_assets = {
        item.get("name"): item.get("sha256")
        for item in assets
        if isinstance(item, dict)
    }
    expected_assets = (
        {
            ffmpeg_policy["macosSource"]["sourceAsset"]: ffmpeg_policy["macosSource"]["sha256"],
            ffmpeg_policy["macosSource"]["libvpxSourceAsset"]: ffmpeg_policy["macosSource"]["libvpxSha256"],
        }
        if target.startswith("macos-")
        else {
            ffmpeg_policy["windowsBuild"]["buildSourceAsset"]: ffmpeg_policy["windowsBuild"]["buildSourceSha256"],
            ffmpeg_policy["windowsBuild"]["ffmpegSourceAsset"]: ffmpeg_policy["windowsBuild"]["ffmpegSourceSha256"],
            ffmpeg_policy["windowsBuild"]["libvpxSourceAsset"]: ffmpeg_policy["windowsBuild"]["libvpxSourceSha256"],
        }
    )
    for name, expected_hash in expected_assets.items():
        if actual_assets.get(name) != expected_hash:
            raise SystemExit(f"SOURCE-MANIFEST.json is missing source asset {name}")

    configuration_file = (licenses / "FFMPEG-CONFIGURATION.txt").read_text(
        encoding="utf-8-sig"
    )
    manifest_configuration = ffmpeg.get("configuration")
    if not isinstance(manifest_configuration, str):
        raise SystemExit("SOURCE-MANIFEST.json is missing the FFmpeg configuration")
    expected_configuration = normalize_configuration(runtime_build_configuration)
    if normalize_configuration(configuration_file) != expected_configuration:
        raise SystemExit("FFMPEG-CONFIGURATION.txt does not match the inspected runtime")
    if normalize_configuration(manifest_configuration) != expected_configuration:
        raise SystemExit("SOURCE-MANIFEST.json FFmpeg configuration does not match the runtime")

    python_source = components["python"]
    for field in ("implementation", "version", "sourceRepository", "sourceRevision", "license"):
        if not isinstance(python_source.get(field), str) or not python_source[field].strip():
            raise SystemExit(f"SOURCE-MANIFEST.json Python provenance is missing {field}")
    return source_manifest


def require_exact_fields(
    document: dict,
    expected: dict,
    fields: tuple[str, ...],
    component: str,
) -> None:
    if not isinstance(document, dict):
        raise SystemExit(f"SOURCE-MANIFEST.json {component} provenance is invalid")
    for field in fields:
        if document.get(field) != expected.get(field):
            raise SystemExit(
                f"SOURCE-MANIFEST.json {component}.{field} does not match source-policy.json"
            )


def normalize_configuration(value: str) -> str:
    return "\n".join(
        line.rstrip()
        for line in value.lstrip("\ufeff").replace("\r\n", "\n").split("\n")
    ).strip()


def normalize_package_name(value: str) -> str:
    return PACKAGE_NAME_SEPARATOR.sub("-", value).lower()


def required_python_packages(project_root: Path, target: str) -> set[str]:
    target_requirements = project_root / f"requirements.{target}.lock.txt"
    requirements = (
        target_requirements
        if target_requirements.is_file()
        else project_root / "requirements.lock.txt"
    )
    packages = set()
    for raw_line in requirements.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        name = re.split(r"[<>=!~\[\s]", line, maxsplit=1)[0]
        packages.add(normalize_package_name(name))
    # pip-licenses intentionally omits itself; it is a build-time auditing tool.
    packages.discard("pip-licenses")
    packages.add("sam-2")
    return packages


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
