#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import package_module as legacy


ENGINE_ABI = "cpa-video-engine-1"
MODEL_SET = "sam2-baseplus-birefnet-1"


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="component", required=True)
    for name in ["engine", "models", "logic"]:
        command = subparsers.add_parser(name)
        command.add_argument("--version", required=True)
        command.add_argument("--licenses", type=Path, required=True)
        command.add_argument("--output-dir", type=Path, required=True)
        command.add_argument("--release-url", required=True)
        command.add_argument(
            "--distribution",
            choices=sorted(legacy.DISTRIBUTIONS),
            default="commercial",
        )
    engine = subparsers.choices["engine"]
    engine.add_argument("--target", choices=sorted(legacy.TARGETS), required=True)
    engine.add_argument("--runtime", type=Path, required=True)
    engine.add_argument("--allow-unsigned-runtime", action="store_true")
    models = subparsers.choices["models"]
    models.add_argument("--models", type=Path, required=True)
    logic = subparsers.choices["logic"]
    logic.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()

    if not legacy.VERSION_PATTERN.fullmatch(args.version) or ".." in args.version:
        raise SystemExit("invalid component version")
    project_root = Path(__file__).resolve().parents[1]
    policy = json.loads((project_root / "source-policy.json").read_text(encoding="utf-8"))
    contract = json.loads((project_root / "module-contract.json").read_text(encoding="utf-8"))
    release_eligible = validate_distribution(args.distribution, policy, args.licenses)
    if args.component == "models":
        validate_models_license_pack(args.licenses, policy, args.distribution)
    elif args.component == "logic":
        validate_logic_license_pack(args.licenses, args.distribution)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.component == "engine":
        package_engine(args, project_root, policy, release_eligible)
    elif args.component == "models":
        package_models(args, policy, release_eligible)
    else:
        package_logic(args, contract, release_eligible)


def validate_distribution(distribution: str, policy: dict, licenses: Path) -> bool:
    distribution_policy = legacy.DISTRIBUTION_POLICIES[distribution]
    allowed = (
        True
        if distribution_policy.release_allowed_key is None
        else bool(policy[distribution_policy.release_allowed_key])
    )
    if not allowed:
        raise SystemExit(policy["commercialReleaseBlocker"])
    if distribution_policy.requires_noncommercial_notice and not (
        licenses / "NONCOMMERCIAL-NOTICE.md"
    ).is_file():
        raise SystemExit("license pack is missing NONCOMMERCIAL-NOTICE.md")
    return bool(allowed and distribution != "internal-poc")


def validate_logic_license_pack(licenses: Path, distribution: str) -> None:
    required = {"THIRD-PARTY-SOURCES.md"}
    if legacy.DISTRIBUTION_POLICIES[distribution].requires_noncommercial_notice:
        required.add("NONCOMMERCIAL-NOTICE.md")
    missing = sorted(name for name in required if not (licenses / name).is_file())
    if missing:
        raise SystemExit(
            "logic license pack is missing required files: " + ", ".join(missing)
        )


def validate_models_license_pack(licenses: Path, policy: dict, distribution: str) -> None:
    required = {
        "THIRD-PARTY-SOURCES.md",
        "SOURCE-MANIFEST.json",
    }
    if legacy.DISTRIBUTION_POLICIES[distribution].requires_noncommercial_notice:
        required.add("NONCOMMERCIAL-NOTICE.md")
    missing = sorted(name for name in required if not (licenses / name).is_file())
    if missing:
        raise SystemExit(
            "models license pack is missing required files: " + ", ".join(missing)
        )
    try:
        source_manifest = json.loads(
            (licenses / "SOURCE-MANIFEST.json").read_text(encoding="utf-8")
        )
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise SystemExit(f"invalid models source manifest: {error}") from error
    components = source_manifest.get("components")
    if not isinstance(components, dict):
        raise SystemExit("models source manifest is missing component provenance")
    source_policy = policy["components"]
    legacy.require_exact_fields(
        components.get("sam2"),
        source_policy["sam2"],
        ("repository", "commit", "checkpointUrl", "checkpointSha256", "license"),
        "SAM2",
    )
    legacy.require_exact_fields(
        components.get("birefnet"),
        source_policy["birefnet"],
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


def package_engine(args, project_root: Path, policy: dict, release_eligible: bool) -> None:
    suffix = ".exe" if args.target == "windows-x86_64" else ""
    entry = args.runtime / f"video-editor-host{suffix}"
    media_dir = args.runtime / "bin"
    ffmpeg = media_dir / f"ffmpeg{suffix}"
    ffprobe = media_dir / f"ffprobe{suffix}"
    for path in [entry, ffmpeg, ffprobe]:
        if not path.is_file():
            raise SystemExit(f"missing engine file: {path}")
    if (args.runtime / "models").exists():
        raise SystemExit("layered engine runtime must not contain model weights")
    if args.allow_unsigned_runtime and args.distribution != "internal-poc":
        raise SystemExit("unsigned runtimes are allowed only for explicitly internal PoC packages")
    platform_signature = (
        "unsigned-internal-poc"
        if args.allow_unsigned_runtime
        else legacy.validate_platform_signature(entry, args.target, args.distribution)
    )
    configuration = inspect_ffmpeg(ffmpeg, args.target, policy)
    legacy.validate_license_pack(
        args.licenses,
        args.target,
        legacy.DISTRIBUTION_POLICIES[args.distribution],
        policy,
        configuration,
        legacy.required_python_packages(project_root, args.target),
    )
    name = f"video-editor-engine-{args.version}-{args.target}.zip"
    with tempfile.TemporaryDirectory(prefix="cpa-video-engine-stage-") as temporary:
        staging = Path(temporary)
        shutil.copytree(args.runtime, staging / "runtime")
        shutil.copytree(args.licenses, staging / "licenses")
        manifest_path = staging / "engine.json"
        write_json(manifest_path, {
            "schemaVersion": 1,
            "type": "engine",
            "version": args.version,
            "target": args.target,
            "engineAbi": ENGINE_ABI,
            "entry": f"runtime/video-editor-host{suffix}",
            "runtimeRoot": "runtime",
            "platformSignature": platform_signature,
            "files": legacy.tree_hashes(staging),
        })
        archive = args.output_dir / name
        legacy.write_zip(staging, archive)
        manifest_sha256 = legacy.sha256(manifest_path)
    write_component_metadata(
        archive,
        args,
        "engine",
        release_eligible,
        target=args.target,
        platform_signature=platform_signature,
        engine_abi=ENGINE_ABI,
        manifest_sha256=manifest_sha256,
    )


def inspect_ffmpeg(ffmpeg: Path, target: str, policy: dict) -> str:
    configuration = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-buildconf"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=True,
    ).stdout
    ffmpeg_policy = policy["components"]["ffmpeg"]
    for flag in ffmpeg_policy["forbiddenConfigureFlags"]:
        if flag in configuration:
            raise SystemExit(f"forbidden FFmpeg flag: {flag}")
    encoders = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-encoders"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=True,
    ).stdout
    required = list(ffmpeg_policy["requiredEncoders"])
    if target.startswith("macos-"):
        required += ffmpeg_policy["macosRequiredEncoders"]
    for encoder in required:
        if encoder not in encoders:
            raise SystemExit(f"FFmpeg is missing {encoder}")
    return configuration


def package_models(args, policy: dict, release_eligible: bool) -> None:
    sam_policy = policy["components"]["sam2"]
    biref_policy = policy["components"]["birefnet"]
    sam = args.models / "sam2" / sam_policy["checkpoint"]
    biref = args.models / "birefnet" / "model.safetensors"
    for path, expected in [
        (sam, sam_policy["checkpointSha256"]),
        (biref, biref_policy["modelSha256"]),
    ]:
        if not path.is_file() or legacy.sha256(path) != expected:
            raise SystemExit(f"model hash mismatch: {path}")
    name = f"video-editor-models-{args.version}.zip"
    with tempfile.TemporaryDirectory(prefix="cpa-video-models-stage-") as temporary:
        staging = Path(temporary)
        shutil.copytree(args.models, staging / "models")
        shutil.copytree(args.licenses, staging / "licenses")
        manifest_path = staging / "models.json"
        write_json(manifest_path, {
            "schemaVersion": 1,
            "type": "models",
            "version": args.version,
            "modelSet": MODEL_SET,
            "modelRoot": "models",
            "files": legacy.tree_hashes(staging),
        })
        archive = args.output_dir / name
        legacy.write_zip(staging, archive)
        manifest_sha256 = legacy.sha256(manifest_path)
    write_component_metadata(
        archive,
        args,
        "models",
        release_eligible,
        model_set=MODEL_SET,
        manifest_sha256=manifest_sha256,
    )


def package_logic(args, contract: dict, release_eligible: bool) -> None:
    for path in [args.source / "__main__.py", args.source / "static" / "index.html"]:
        if not path.is_file():
            raise SystemExit(f"missing business source: {path}")
    name = f"video-editor-logic-{args.version}.zip"
    with tempfile.TemporaryDirectory(prefix="cpa-video-logic-stage-") as temporary:
        staging = Path(temporary)
        shutil.copytree(
            args.source,
            staging / "video_editor_module",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
        )
        shutil.copytree(args.licenses, staging / "licenses")
        manifest_path = staging / "module.json"
        write_json(manifest_path, {
            "schemaVersion": 2,
            "type": "logic",
            "id": contract["id"],
            "version": args.version,
            "engineAbi": ENGINE_ABI,
            "modelSet": MODEL_SET,
            "moduleRoot": ".",
            "capabilities": contract["capabilities"],
            "files": legacy.tree_hashes(staging),
        })
        archive = args.output_dir / name
        legacy.write_zip(staging, archive)
        manifest_sha256 = legacy.sha256(manifest_path)
    write_component_metadata(
        archive,
        args,
        "logic",
        release_eligible,
        engine_abi=ENGINE_ABI,
        model_set=MODEL_SET,
        manifest_sha256=manifest_sha256,
    )


def write_component_metadata(
    archive: Path,
    args,
    component: str,
    release_eligible: bool,
    *,
    target: str | None = None,
    platform_signature: str | None = None,
    engine_abi: str | None = None,
    model_set: str | None = None,
    manifest_sha256: str,
) -> None:
    document = {
        "component": component,
        "version": args.version,
        "distribution": args.distribution,
        "packageAuthenticity": "tauri-minisign-index+sha256",
        "publicIndexSignatureRequired": (
            args.distribution != "internal-poc"
        ),
        "url": args.release_url.rstrip("/") + "/" + archive.name,
        "sha256": legacy.sha256(archive),
        "size": archive.stat().st_size,
        "releaseEligible": release_eligible,
        "manifestSha256": manifest_sha256,
    }
    if target:
        document["target"] = target
    if platform_signature:
        document["platformSignature"] = platform_signature
    if engine_abi:
        document["engineAbi"] = engine_abi
    if model_set:
        document["modelSet"] = model_set
    write_json(archive.with_suffix(".component.json"), document)
    print(archive)
    print(json.dumps(document, separators=(",", ":")))


def write_json(path: Path, document: dict) -> None:
    path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
