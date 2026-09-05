#!/usr/bin/env python3
"""Build content-addressed Electron runtime and CockroachPet logic components."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import struct
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Callable, Iterable

import package_module as legacy


ROOT = Path(__file__).resolve().parents[1]
TARGETS = legacy.TARGETS
DISTRIBUTION = "noncommercial-open-source"
CONTRACT = json.loads((ROOT / "module-contract.json").read_text(encoding="utf-8"))
RUNTIME_ABI = CONTRACT["runtimeAbi"]
LOGIC_FILES = ("main.js", "package.json", "package-lock.json", "src", "assets")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_hashes(root: Path) -> list[dict]:
    result = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            target = os.readlink(path)
            value = PurePosixPath(target)
            if value.is_absolute() or ".." in value.parts:
                raise ValueError(f"component has an unsafe symlink: {path} -> {target}")
            data = target.encode("utf-8")
            result.append({
                "path": path.relative_to(root).as_posix(),
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "linkTarget": target,
            })
        elif path.is_file():
            result.append({
                "path": path.relative_to(root).as_posix(),
                "size": path.stat().st_size,
                "sha256": sha256(path),
            })
    if not result:
        raise ValueError("component file manifest cannot be empty")
    return result


def write_json(path: Path, document: dict) -> None:
    path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_zip(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_symlink():
                target = os.readlink(path)
                value = PurePosixPath(target)
                if value.is_absolute() or ".." in value.parts:
                    raise ValueError(f"component has an unsafe symlink: {path} -> {target}")
                info = zipfile.ZipInfo(path.relative_to(source).as_posix())
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, target.encode("utf-8"))
            elif path.is_file():
                archive.write(path, path.relative_to(source).as_posix())


def validate_version(value: str) -> None:
    if (
        not value
        or len(value) > 64
        or value[0] not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        or value[-1] not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        or ".." in value
        or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-+" for character in value)
    ):
        raise ValueError("invalid component version")


def validate_license_pack(licenses: Path) -> None:
    required = {
        "CockroachPet-MIT.txt",
        "NONCOMMERCIAL-NOTICE.md",
        "THIRD-PARTY-SOURCES.md",
    }
    missing = sorted(name for name in required if not (licenses / name).is_file())
    if missing:
        raise ValueError("license pack is missing: " + ", ".join(missing))


def runtime_entry_path(runtime_dir: Path, entry: str) -> Path:
    relative = PurePosixPath(entry)
    if relative.is_absolute() or not relative.parts or relative.parts[0] != "runtime" or ".." in relative.parts:
        raise ValueError("runtime entry must be a safe path below runtime/")
    return runtime_dir.joinpath(*relative.parts[1:])


def validate_macos_macho_architectures(runtime_dir: Path, expected_arch: str) -> None:
    checked: set[Path] = set()
    macho_count = 0
    for path in sorted(runtime_dir.rglob("*")):
        if not path.is_file():
            continue
        resolved = path.resolve()
        if resolved in checked:
            continue
        checked.add(resolved)
        description = subprocess.check_output(["file", "-b", resolved], text=True)
        if "Mach-O" not in description:
            continue
        macho_count += 1
        architectures = subprocess.check_output(["lipo", "-archs", resolved], text=True).split()
        if architectures != [expected_arch]:
            relative = path.relative_to(runtime_dir)
            raise ValueError(
                f"Electron runtime Mach-O architecture mismatch for {relative}: {architectures}"
            )
    if macho_count == 0:
        raise ValueError("Electron runtime contains no Mach-O binaries")


def validate_platform_runtime(runtime_dir: Path, entry: str, target: str, version: str) -> str:
    executable = runtime_entry_path(runtime_dir, entry)
    if not executable.is_file():
        raise ValueError(f"runtime entry is missing: {executable}")
    version_file = runtime_dir / "version"
    if version_file.is_file() and version_file.read_text(encoding="utf-8").strip() != version:
        raise ValueError("Electron runtime version does not match the component version")
    for notice in ["LICENSE", "LICENSES.chromium.html"]:
        path = runtime_dir / notice
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"Electron runtime is missing upstream notice: {notice}")
    if target.startswith("macos-"):
        expected_arch = "arm64" if target == "macos-arm64" else "x86_64"
        validate_macos_macho_architectures(runtime_dir, expected_arch)
        app = runtime_dir / "Electron.app"
        subprocess.run(
            ["codesign", "--verify", "--deep", "--strict", "--verbose=2", app],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        return f"codesign-valid-{expected_arch}"
    if target == "windows-x86_64":
        with executable.open("rb") as source:
            if source.read(2) != b"MZ":
                raise ValueError("Electron Windows runtime is not a PE executable")
            source.seek(0x3C)
            pe_offset = struct.unpack("<I", source.read(4))[0]
            source.seek(pe_offset)
            if source.read(4) != b"PE\0\0" or struct.unpack("<H", source.read(2))[0] != 0x8664:
                raise ValueError("Electron Windows runtime is not x86_64")
        return "pe-x86_64"
    raise ValueError(f"unsupported target: {target}")


def prepare_platform_runtime_copy(runtime_dir: Path, target: str) -> None:
    if not target.startswith("macos-"):
        return
    app = runtime_dir / "Electron.app"
    if not app.is_dir():
        raise ValueError("macOS Electron runtime is missing Electron.app")
    try:
        subprocess.run(
            ["codesign", "--force", "--deep", "--sign", "-", app],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
    except subprocess.CalledProcessError as error:
        raise ValueError(f"unable to ad-hoc sign Electron runtime: {error.stderr}") from error


def component_document(
    archive: Path,
    component: str,
    version: str,
    release_url: str,
    manifest_sha256: str,
    release_eligible: bool = True,
    **extra,
) -> dict:
    return {
        "component": component,
        "version": version,
        "distribution": DISTRIBUTION,
        "packageAuthenticity": "tauri-minisign-index+sha256",
        "publicIndexSignatureRequired": True,
        "releaseEligible": release_eligible,
        "runtimeAbi": RUNTIME_ABI,
        "manifestSha256": manifest_sha256,
        "url": release_url.rstrip("/") + "/" + archive.name,
        "sha256": sha256(archive),
        "size": archive.stat().st_size,
        **extra,
    }


def package_runtime(
    *,
    runtime_dir: Path,
    entry: str,
    target: str,
    version: str,
    licenses: Path,
    output_dir: Path,
    release_url: str,
    platform_validator: Callable[[Path, str, str, str], str] = validate_platform_runtime,
    runtime_preparer: Callable[[Path, str], None] | None = None,
) -> tuple[Path, dict]:
    validate_version(version)
    validate_license_pack(licenses)
    if target not in TARGETS:
        raise ValueError(f"unsupported target: {target}")
    runtime_dir = runtime_dir.resolve()
    if not runtime_dir.is_dir():
        raise ValueError(f"runtime directory does not exist: {runtime_dir}")
    name = f"cockroach-runtime-{version}-{target}.zip"
    with tempfile.TemporaryDirectory(prefix="cpa-cockroach-runtime-") as temporary:
        staging = Path(temporary)
        shutil.copytree(runtime_dir, staging / "runtime", symlinks=True)
        preparer = runtime_preparer
        if preparer is None and platform_validator is validate_platform_runtime:
            preparer = prepare_platform_runtime_copy
        if preparer is not None:
            preparer(staging / "runtime", target)
        platform_signature = platform_validator(staging / "runtime", entry, target, version)
        shutil.copytree(licenses, staging / "licenses", symlinks=False)
        executable = staging.joinpath(*PurePosixPath(entry).parts)
        if not executable.is_file():
            raise ValueError("runtime entry is missing after staging")
        manifest = staging / "runtime.json"
        write_json(manifest, {
            "schemaVersion": 1,
            "type": "runtime",
            "version": version,
            "target": target,
            "runtimeAbi": RUNTIME_ABI,
            "entry": entry,
            "runtimeRoot": "runtime",
            "distribution": DISTRIBUTION,
            "platformSignature": platform_signature,
            "files": tree_hashes(staging),
        })
        archive = output_dir / name
        write_zip(staging, archive)
        manifest_sha256 = sha256(manifest)
    document = component_document(
        archive,
        "runtime",
        version,
        release_url,
        manifest_sha256,
        target=target,
        platformSignature=platform_signature,
        release_eligible=False,
    )
    write_json(archive.with_suffix(".component.json"), document)
    return archive, document


def discover_production_dependencies(source_dir: Path) -> list[Path]:
    output = subprocess.check_output(
        ["npm", "ls", "--omit=dev", "--parseable", "--all"],
        cwd=source_dir,
        text=True,
    )
    root = source_dir.resolve()
    dependencies = []
    for value in output.splitlines()[1:]:
        path = Path(value).resolve()
        try:
            relative = path.relative_to(root)
        except ValueError as error:
            raise ValueError(f"production dependency escapes source root: {path}") from error
        if not relative.parts or relative.parts[0] != "node_modules" or not path.is_dir():
            raise ValueError(f"invalid production dependency: {path}")
        dependencies.append(path)
    return dependencies


def dependency_inventory(dependencies: Iterable[Path]) -> tuple[str, list[dict]]:
    packages = []
    for dependency in dependencies:
        package_json = dependency / "package.json"
        try:
            document = json.loads(package_json.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError(f"invalid production dependency package.json: {dependency}") from error
        name = document.get("name")
        version = document.get("version")
        license_value = document.get("license")
        if not all(isinstance(value, str) and value.strip() for value in [name, version, license_value]):
            raise ValueError(f"production dependency lacks name/version/license: {dependency}")
        license_files = []
        for path in sorted(dependency.iterdir()):
            if path.is_file() and path.name.lower().startswith(("license", "licence", "copying")):
                license_files.append({"name": path.name, "sha256": sha256(path)})
        packages.append({
            "name": name,
            "version": version,
            "license": license_value,
            "packageJsonSha256": sha256(package_json),
            "licenseFiles": license_files,
        })
    packages.sort(key=lambda value: (value["name"], value["version"], value["packageJsonSha256"]))
    encoded = json.dumps(packages, sort_keys=True, separators=(",", ":")).encode("utf-8")
    dependency_set = "cockroach-js-" + hashlib.sha256(encoded).hexdigest()[:16]
    return dependency_set, packages


def copy_dependencies(source_dir: Path, destination: Path, dependencies: Iterable[Path]) -> None:
    root = source_dir.resolve()
    for dependency in dependencies:
        dependency = dependency.resolve()
        relative = dependency.relative_to(root)
        if not relative.parts or relative.parts[0] != "node_modules":
            raise ValueError(f"invalid production dependency: {dependency}")
        target = destination / relative
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(dependency, target, symlinks=False)


def copy_logic_source(source_dir: Path, destination: Path) -> None:
    for name in LOGIC_FILES:
        source = source_dir / name
        target = destination / name
        if source.is_dir():
            shutil.copytree(source, target, symlinks=False)
        elif source.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        else:
            raise ValueError(f"required business source is missing: {source}")


def package_dependencies(
    *,
    source_dir: Path,
    production_dependencies: Iterable[Path],
    version: str,
    licenses: Path,
    output_dir: Path,
    release_url: str,
) -> tuple[Path, dict]:
    validate_version(version)
    validate_license_pack(licenses)
    source_dir = source_dir.resolve()
    dependencies = list(production_dependencies)
    dependency_set, inventory = dependency_inventory(dependencies)
    name = f"cockroach-dependencies-{version}.zip"
    with tempfile.TemporaryDirectory(prefix="cpa-cockroach-dependencies-") as temporary:
        staging = Path(temporary)
        dependency_root = staging / "dependencies"
        copy_dependencies(source_dir, dependency_root, dependencies)
        shutil.copytree(licenses, staging / "licenses", symlinks=False)
        write_json(staging / "licenses" / "JS-PACKAGE-LICENSES.json", inventory)
        manifest = staging / "dependencies.json"
        write_json(manifest, {
            "schemaVersion": 1,
            "type": "dependencies",
            "version": version,
            "dependencySet": dependency_set,
            "dependencyRoot": "dependencies/node_modules",
            "distribution": DISTRIBUTION,
            "files": tree_hashes(staging),
        })
        archive = output_dir / name
        write_zip(staging, archive)
        manifest_sha256 = sha256(manifest)
    document = component_document(
        archive,
        "dependencies",
        version,
        release_url,
        manifest_sha256,
        dependencySet=dependency_set,
    )
    write_json(archive.with_suffix(".component.json"), document)
    return archive, document


def package_logic(
    *,
    source_dir: Path,
    version: str,
    dependency_set: str,
    licenses: Path,
    output_dir: Path,
    release_url: str,
    source_verifier: Callable[[Path], None] = legacy.verify_patched_source,
) -> tuple[Path, dict]:
    validate_version(version)
    if not dependency_set.startswith("cockroach-js-") or len(dependency_set) != 29:
        raise ValueError("invalid Cockroach dependency set")
    validate_license_pack(licenses)
    source_dir = source_dir.resolve()
    source_verifier(source_dir)
    name = f"cockroach-logic-{version}.zip"
    with tempfile.TemporaryDirectory(prefix="cpa-cockroach-logic-") as temporary:
        staging = Path(temporary)
        logic = staging / "logic"
        copy_logic_source(source_dir, logic)
        shutil.copytree(licenses, staging / "licenses", symlinks=False)
        if any(path.name.lower() in {"electron", "electron.exe", "electron.app"} for path in logic.rglob("*")):
            raise ValueError("business component must not contain an Electron runtime")
        manifest = staging / "module.json"
        write_json(manifest, {
            "schemaVersion": 2,
            "type": "logic",
            "id": CONTRACT["id"],
            "version": version,
            "runtimeAbi": RUNTIME_ABI,
            "dependencySet": dependency_set,
            "moduleRoot": "logic",
            "distribution": DISTRIBUTION,
            "capabilities": CONTRACT["capabilities"],
            "runtimeContribution": CONTRACT["runtimeContribution"],
            "upstream": {
                "repository": "https://github.com/jo9900/CockroachPet-Public-Electron",
                "commit": legacy.UPSTREAM_COMMIT,
                "integrationPatch": "cpa-control-file-v3",
            },
            "files": tree_hashes(staging),
        })
        archive = output_dir / name
        write_zip(staging, archive)
        manifest_sha256 = sha256(manifest)
    document = component_document(
        archive,
        "logic",
        version,
        release_url,
        manifest_sha256,
        dependencySet=dependency_set,
    )
    write_json(archive.with_suffix(".component.json"), document)
    return archive, document


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="component", required=True)
    runtime = subparsers.add_parser("runtime")
    runtime.add_argument("--runtime-dir", type=Path, required=True)
    runtime.add_argument("--entry", required=True)
    runtime.add_argument("--target", choices=sorted(TARGETS), required=True)
    runtime.add_argument("--version", required=True)
    logic = subparsers.add_parser("logic")
    logic.add_argument("--source-dir", type=Path, required=True)
    logic.add_argument("--version", required=True)
    dependencies = subparsers.add_parser("dependencies")
    dependencies.add_argument("--source-dir", type=Path, required=True)
    dependencies.add_argument("--version", required=True)
    logic.add_argument("--dependency-set")
    for command in [runtime, dependencies, logic]:
        command.add_argument("--licenses", type=Path, default=ROOT / "licenses")
        command.add_argument("--output-dir", type=Path, required=True)
        command.add_argument("--release-url", required=True)
    args = parser.parse_args()
    if args.component == "runtime":
        archive, document = package_runtime(
            runtime_dir=args.runtime_dir,
            entry=args.entry,
            target=args.target,
            version=args.version,
            licenses=args.licenses,
            output_dir=args.output_dir,
            release_url=args.release_url,
        )
    elif args.component == "dependencies":
        dependencies = discover_production_dependencies(args.source_dir)
        archive, document = package_dependencies(
            source_dir=args.source_dir,
            production_dependencies=dependencies,
            version=args.version,
            licenses=args.licenses,
            output_dir=args.output_dir,
            release_url=args.release_url,
        )
    else:
        dependencies = discover_production_dependencies(args.source_dir)
        dependency_set = args.dependency_set or dependency_inventory(dependencies)[0]
        archive, document = package_logic(
            source_dir=args.source_dir,
            version=args.version,
            dependency_set=dependency_set,
            licenses=args.licenses,
            output_dir=args.output_dir,
            release_url=args.release_url,
        )
    print(archive)
    print(json.dumps(document, separators=(",", ":")))


if __name__ == "__main__":
    main()
