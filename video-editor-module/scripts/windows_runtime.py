"""Keep Windows x64 engines portable beyond Windows-on-ARM build machines."""
from __future__ import annotations

import shutil
import struct
from pathlib import Path


AMD64 = 0x8664
PE_SUFFIXES = {".exe", ".dll", ".pyd"}
MACHINE_NAMES = {0x014C: "x86", AMD64: "x64", 0xAA64: "ARM64/ARM64X", 0xA641: "ARM64EC", 0xA64E: "ARM64X"}
REQUIRED_CRT = {"msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"}


def pe_machine(path: Path) -> int:
    """Read the on-disk PE header, without Windows loader architecture redirection."""
    with path.open("rb") as source:
        dos = source.read(64)
        if len(dos) != 64 or dos[:2] != b"MZ":
            raise SystemExit(f"invalid Windows PE file: {path}")
        offset = struct.unpack_from("<I", dos, 60)[0]
        if offset < 64:
            raise SystemExit(f"invalid Windows PE offset: {path}")
        source.seek(offset)
        header = source.read(6)
        if len(header) != 6 or header[:4] != b"PE\0\0":
            raise SystemExit(f"invalid Windows PE header: {path}")
        return struct.unpack_from("<H", header, 4)[0]


def require_x64(path: Path) -> None:
    machine = pe_machine(path)
    if machine != AMD64:
        name = MACHINE_NAMES.get(machine, f"0x{machine:04x}")
        raise SystemExit(
            f"Windows x64 runtime contains {path}: {name}; expected x64 (0x8664). "
            "Rebuild with --windows-crt-dir pointing to VC/Redist/MSVC/<version>/"
            "x64/Microsoft.VC143.CRT, never the compiler's HostARM64/x64 directory."
        )


def validate_windows_runtime(runtime: Path) -> int:
    """Check every bundled native file, including NumPy/PyTorch dependencies."""
    files = sorted(path for path in runtime.rglob("*") if path.is_file() and path.suffix.lower() in PE_SUFFIXES)
    if not files:
        raise SystemExit(f"Windows runtime contains no PE files: {runtime}")
    for path in files:
        require_x64(path)
    return len(files)


def windows_crt_files(directory: Path) -> list[Path]:
    files = sorted(directory.glob("*.dll"))
    missing = REQUIRED_CRT - {path.name.lower() for path in files}
    if missing:
        raise SystemExit(f"Windows x64 CRT directory is missing {', '.join(sorted(missing))}: {directory}")
    # Check the entire selected redistributable before copying anything. Names
    # such as HostARM64/x64 describe the compiler target, not its own DLLs.
    for path in files:
        require_x64(path)
    return files


def install_windows_crt(runtime: Path, directory: Path) -> None:
    files = windows_crt_files(directory)
    internal = runtime / "_internal"
    if not internal.is_dir():
        raise SystemExit(f"missing PyInstaller runtime directory: {internal}")
    # Use one coherent Microsoft redistributable set instead of whichever CRT
    # PyInstaller found first on the build machine's PATH or in System32.
    for source in files:
        shutil.copy2(source, internal / source.name)
