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
            "import json,platform; print(json.dumps([platform.system(),platform.machine()]))",
        ],
        text=True,
    )
    system, raw_machine = json.loads(output)
    machine = raw_machine.lower()
    if system == "Darwin" and machine in {"arm64", "aarch64"}:
        return "macos-arm64"
    if system == "Darwin" and machine in {"x86_64", "amd64"}:
        return "macos-x86_64"
    if system == "Windows" and machine in {"x86_64", "amd64"}:
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
    temporary = target.with_suffix(target.suffix + ".download")
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
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

        sam_target = args.output / "models" / "sam2" / sam_policy["checkpoint"]
        download(sam_policy["checkpointUrl"], sam_target, sam_policy["checkpointSha256"])

        biref_policy = policy["components"]["birefnet"]
        biref_target = args.output / "models" / "birefnet"
        script = (
            "from huggingface_hub import snapshot_download; "
            "snapshot_download(repo_id=sys.argv[1], revision=sys.argv[2], "
            "local_dir=sys.argv[3], local_dir_use_symlinks=False)"
        )
        run(
            python,
            "-c",
            "import sys; " + script,
            biref_policy["modelRepository"].removeprefix("https://huggingface.co/"),
            biref_policy["modelRevision"],
            biref_target,
        )
        model = biref_target / "model.safetensors"
        if digest(model) != biref_policy["modelSha256"]:
            raise SystemExit("BiRefNet checkpoint hash mismatch")

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
        print(args.output)
    finally:
        if temporary is not None:
            temporary.cleanup()


if __name__ == "__main__":
    main()
