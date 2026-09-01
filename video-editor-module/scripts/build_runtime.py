#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path


TARGETS = {"macos-arm64", "macos-x86_64", "windows-x86_64"}


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def interpreter_target(python: Path) -> str:
    output = subprocess.check_output(
        [
            str(python),
            "-c",
            (
                "import json,platform,sysconfig; "
                "print(json.dumps([platform.system(),platform.machine(),sysconfig.get_platform()]))"
            ),
        ],
        text=True,
    )
    system, raw_machine, python_platform = json.loads(output)
    return target_from_platform(system, raw_machine, python_platform)


def target_from_platform(system: str, raw_machine: str, python_platform: str) -> str:
    machine = raw_machine.lower()
    if system == "Darwin" and machine in {"arm64", "aarch64"}:
        return "macos-arm64"
    if system == "Darwin" and machine in {"x86_64", "amd64"}:
        return "macos-x86_64"
    if system == "Windows" and python_platform.lower() == "win-amd64":
        return "windows-x86_64"
    return "unsupported"


def run(
    *arguments: str | Path,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> None:
    subprocess.run([str(value) for value in arguments], cwd=cwd, env=env, check=True)


def download(url: str, target: Path, expected_hash: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and digest(target) == expected_hash:
        return
    temporary = target.with_suffix(target.suffix + ".download")
    if temporary.is_file() and digest(temporary) == expected_hash:
        temporary.replace(target)
        return
    offset = temporary.stat().st_size if temporary.is_file() else 0
    request = urllib.request.Request(
        url,
        headers={"Range": f"bytes={offset}-"} if offset else {},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        append = offset > 0 and getattr(response, "status", None) == 206
        mode = "ab" if append else "wb"
        with temporary.open(mode) as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
    if digest(temporary) != expected_hash:
        temporary.unlink(missing_ok=True)
        raise SystemExit(f"download hash mismatch: {target.name}")
    temporary.replace(target)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    parser.add_argument("--ffmpeg-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--licenses-output", type=Path, required=True)
    parser.add_argument("--python", type=Path, default=Path(sys.executable))
    parser.add_argument("--work-dir", type=Path)
    args = parser.parse_args()

    args.python = args.python.resolve()
    detected = interpreter_target(args.python)
    if detected != args.target:
        raise SystemExit(
            f"runtime must be built natively: requested {args.target}, current interpreter is {detected}"
        )
    project_root = Path(__file__).resolve().parents[1]
    source_commit = clean_source_commit(project_root)
    policy = json.loads((project_root / "source-policy.json").read_text(encoding="utf-8"))
    suffix = ".exe" if args.target == "windows-x86_64" else ""
    for name in [f"ffmpeg{suffix}", f"ffprobe{suffix}"]:
        if not (args.ffmpeg_dir / name).is_file():
            raise SystemExit(f"missing audited media binary: {args.ffmpeg_dir / name}")

    temporary = None
    if args.work_dir is None:
        temporary = tempfile.TemporaryDirectory(prefix="cpa-video-runtime-build-")
        work = Path(temporary.name)
    else:
        work = args.work_dir.resolve()
        work.mkdir(parents=True, exist_ok=True)
    try:
        environment = work / "venv"
        if not environment.exists():
            run(args.python, "-m", "venv", environment)
        python = environment / (
            "Scripts/python.exe" if args.target == "windows-x86_64" else "bin/python"
        )
        run(python, "-m", "pip", "install", "--upgrade", "pip")
        target_requirements = project_root / f"requirements.{args.target}.lock.txt"
        requirements = (
            target_requirements if target_requirements.is_file() else project_root / "requirements.lock.txt"
        )
        run(python, "-m", "pip", "install", "-r", requirements)
        sam_policy = policy["components"]["sam2"]
        sam_environment = dict(os.environ)
        sam_environment["SAM2_BUILD_CUDA"] = "0"
        sam_environment["SAM2_BUILD_ALLOW_ERRORS"] = "0"
        run(
            python,
            "-m",
            "pip",
            "install",
            "--no-deps",
            "--no-build-isolation",
            f"git+{sam_policy['repository']}.git@{sam_policy['commit']}",
            env=sam_environment,
        )
        run(
            python,
            "-c",
            (
                "import torch, transformers; "
                "assert transformers.is_torch_available(); "
                "from sam2.build_sam import build_sam2_video_predictor; "
                "from transformers import AutoModelForImageSegmentation; "
                "print(torch.__version__, transformers.__version__)"
            ),
        )

        model_cache = work / "model-cache"
        dist = work / "dist"
        build = work / "pyinstaller"
        run(
            python,
            "-m",
            "PyInstaller",
            "--clean",
            "--noconfirm",
            "--distpath",
            dist,
            "--workpath",
            build,
            project_root / "video_editor_module.spec",
            cwd=project_root,
        )
        frozen = dist / "video-editor-module"
        if args.output.exists():
            shutil.rmtree(args.output)
        shutil.copytree(frozen, args.output)

        media_dir = args.output / "bin"
        shutil.copytree(args.ffmpeg_dir, media_dir)

        sam_cached = model_cache / "sam2" / sam_policy["checkpoint"]
        download(sam_policy["checkpointUrl"], sam_cached, sam_policy["checkpointSha256"])
        sam_target = args.output / "models" / "sam2" / sam_policy["checkpoint"]
        sam_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(sam_cached, sam_target)

        biref_policy = policy["components"]["birefnet"]
        biref_cached = model_cache / "birefnet"
        biref_target = args.output / "models" / "birefnet"
        script = (
            "from huggingface_hub import snapshot_download; "
            "snapshot_download(repo_id=sys.argv[1], revision=sys.argv[2], "
            "local_dir=sys.argv[3], local_dir_use_symlinks=False)"
        )
        cached_model = biref_cached / "model.safetensors"
        if not cached_model.is_file() or digest(cached_model) != biref_policy["modelSha256"]:
            run(
                python,
                "-c",
                "import sys; " + script,
                biref_policy["modelRepository"].removeprefix("https://huggingface.co/"),
                biref_policy["modelRevision"],
                biref_cached,
            )
        model = biref_cached / "model.safetensors"
        if digest(model) != biref_policy["modelSha256"]:
            raise SystemExit("BiRefNet checkpoint hash mismatch")
        if biref_target.exists():
            shutil.rmtree(biref_target)
        shutil.copytree(biref_cached, biref_target)

        if args.licenses_output.exists():
            shutil.rmtree(args.licenses_output)
        shutil.copytree(project_root / "licenses", args.licenses_output)
        run(
            python,
            "-m",
            "piplicenses",
            "--format=json",
            "--with-license-file",
            "--output-file",
            args.licenses_output / "PYTHON-PACKAGE-LICENSES.json",
        )
        ffmpeg_license = subprocess.run(
            [str(media_dir / f"ffmpeg{suffix}"), "-hide_banner", "-L"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=True,
        ).stdout
        (args.licenses_output / "FFMPEG-LICENSE.txt").write_text(
            ffmpeg_license,
            encoding="utf-8",
        )
        ffmpeg_configuration = subprocess.run(
            [str(media_dir / f"ffmpeg{suffix}"), "-hide_banner", "-buildconf"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=True,
        ).stdout
        (args.licenses_output / "FFMPEG-CONFIGURATION.txt").write_text(
            ffmpeg_configuration,
            encoding="utf-8",
        )
        python_license_script = (
            "from pathlib import Path; import sys; "
            "root=Path(sys.base_prefix); "
            "items=[root/'LICENSE.txt',root/'LICENSE',root.parent/'LICENSE']; "
            "print(next((str(p) for p in items if p.is_file()),''))"
        )
        python_license = subprocess.check_output(
            [str(python), "-c", python_license_script],
            text=True,
        ).strip()
        if python_license:
            shutil.copy2(python_license, args.licenses_output / "PYTHON-LICENSE.txt")
        python_details = json.loads(subprocess.check_output(
            [
                str(python),
                "-c",
                (
                    "import json,platform; "
                    "print(json.dumps([platform.python_implementation(),platform.python_version()]))"
                ),
            ],
            text=True,
        ))
        source_manifest = source_manifest_document(
            policy,
            args.target,
            source_commit,
            ffmpeg_configuration,
            python_details[0],
            python_details[1],
        )
        (args.licenses_output / "SOURCE-MANIFEST.json").write_text(
            json.dumps(source_manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(args.output)
    finally:
        if temporary is not None:
            temporary.cleanup()


def clean_source_commit(project_root: Path) -> str:
    status = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all", "--", "."],
        cwd=project_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=True,
    ).stdout
    if status.strip():
        raise SystemExit("video-editor-module source is dirty; commit or clean it before building")
    commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=project_root, text=True
    ).strip()
    if len(commit) != 40:
        raise SystemExit("unable to resolve a full source commit")
    return commit


def source_manifest_document(
    policy: dict,
    target: str,
    source_commit: str,
    ffmpeg_configuration: str,
    python_implementation: str,
    python_version: str,
) -> dict:
    components = policy["components"]
    sam = components["sam2"]
    birefnet = components["birefnet"]
    ffmpeg_policy = components["ffmpeg"]
    ffmpeg_source = (
        ffmpeg_policy["windowsBuild"]
        if target == "windows-x86_64"
        else ffmpeg_policy["macosSource"]
    )
    if target == "windows-x86_64":
        ffmpeg_component = {
            **ffmpeg_source,
            "commit": ffmpeg_source["ffmpegCommit"],
            "sourceUrl": ffmpeg_source["ffmpegSourceUrl"],
            "sourceSha256": ffmpeg_source["ffmpegSourceSha256"],
            "configuration": ffmpeg_configuration,
        }
        libvpx_source = {
            "repository": ffmpeg_source["libvpxRepository"],
            "commit": ffmpeg_source["libvpxCommit"],
            "sourceUrl": ffmpeg_source["libvpxSourceUrl"],
            "sourceSha256": ffmpeg_source["libvpxSourceSha256"],
            "license": "BSD-3-Clause",
        }
        source_assets = [
            {
                "name": ffmpeg_source["buildSourceAsset"],
                "sha256": ffmpeg_source["buildSourceSha256"],
            },
            {
                "name": ffmpeg_source["ffmpegSourceAsset"],
                "sha256": ffmpeg_source["ffmpegSourceSha256"],
            },
            {
                "name": ffmpeg_source["libvpxSourceAsset"],
                "sha256": ffmpeg_source["libvpxSourceSha256"],
            },
        ]
    else:
        ffmpeg_component = {**ffmpeg_source, "configuration": ffmpeg_configuration}
        libvpx_source = {
            "version": ffmpeg_source["libvpxVersion"],
            "url": ffmpeg_source["libvpxUrl"],
            "sha256": ffmpeg_source["libvpxSha256"],
            "license": "BSD-3-Clause",
        }
        source_assets = [
            {"name": ffmpeg_source["sourceAsset"], "sha256": ffmpeg_source["sha256"]},
            {
                "name": ffmpeg_source["libvpxSourceAsset"],
                "sha256": ffmpeg_source["libvpxSha256"],
            },
        ]
    return {
        "schemaVersion": 1,
        "target": target,
        "sourceCommit": source_commit,
        "sourceAvailability": {"assets": source_assets},
        "components": {
            "sam2": {
                "repository": sam["repository"],
                "commit": sam["commit"],
                "checkpointUrl": sam["checkpointUrl"],
                "checkpointSha256": sam["checkpointSha256"],
                "license": sam["license"],
            },
            "birefnet": {
                "repository": birefnet["repository"],
                "commit": birefnet["commit"],
                "modelRepository": birefnet["modelRepository"],
                "modelRevision": birefnet["modelRevision"],
                "modelSha256": birefnet["modelSha256"],
                "declaredLicense": birefnet["declaredLicense"],
            },
            "ffmpeg": ffmpeg_component,
            "libvpx": libvpx_source,
            "python": {
                "implementation": python_implementation,
                "version": python_version,
                "sourceRepository": "https://github.com/python/cpython",
                "sourceRevision": f"v{python_version}",
                "license": "Python-2.0",
            },
        },
    }


if __name__ == "__main__":
    main()
