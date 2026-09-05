from __future__ import annotations

import struct
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import package_layers
import package_module
import build_runtime
import windows_runtime


def write_pe(path: Path, machine: int = 0x8664) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header = bytearray(128)
    header[:2] = b"MZ"
    struct.pack_into("<I", header, 60, 64)
    header[64:68] = b"PE\0\0"
    struct.pack_into("<H", header, 68, machine)
    path.write_bytes(header)


class WindowsRuntimeTests(unittest.TestCase):
    def test_builder_replaces_host_arm_crt_with_complete_x64_redist(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            frozen, media, crt = root / "frozen", root / "media", root / "crt"
            write_pe(frozen / "video-editor-host.exe")
            write_pe(frozen / "_internal/numpy/_core/_multiarray_umath.cp314-win_amd64.pyd")
            for name in ["msvcp140.dll", "vcruntime140.dll"]:
                write_pe(frozen / "_internal" / name, 0xAA64)
            write_pe(media / "ffmpeg.exe")
            write_pe(media / "ffprobe.exe")
            for name in windows_runtime.REQUIRED_CRT | {"msvcp140_atomic_wait.dll"}:
                write_pe(crt / name)

            build_runtime.prepare_frozen_runtime(frozen, media, "windows-x86_64", crt)

            self.assertEqual(windows_runtime.validate_windows_runtime(frozen), 8)
            for source in crt.iterdir():
                self.assertEqual((frozen / "_internal" / source.name).read_bytes(), source.read_bytes())

    def test_builder_rejects_wrong_architecture_in_nested_dependency_or_ffmpeg(self):
        for bad_file in ["_internal/numpy.libs/openblas.dll", "_internal/torch/lib/torch_cpu.dll", "bin/ffmpeg.exe"]:
            with self.subTest(file=bad_file), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                frozen, media, crt = root / "frozen", root / "media", root / "crt"
                write_pe(frozen / "video-editor-host.exe")
                (frozen / "_internal").mkdir()
                write_pe(media / "ffmpeg.exe")
                write_pe(media / "ffprobe.exe")
                for name in windows_runtime.REQUIRED_CRT:
                    write_pe(crt / name)
                path = media / "ffmpeg.exe" if bad_file.startswith("bin/") else frozen / bad_file
                write_pe(path, 0xAA64)
                with self.assertRaisesRegex(SystemExit, "ARM64"):
                    build_runtime.prepare_frozen_runtime(frozen, media, "windows-x86_64", crt)

    def test_bad_crt_source_is_rejected_before_any_replacement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            frozen, crt = root / "frozen", root / "crt"
            original = frozen / "_internal/msvcp140.dll"
            write_pe(original)
            before = original.read_bytes()
            for name in windows_runtime.REQUIRED_CRT:
                write_pe(crt / name)
            write_pe(crt / "vcruntime140.dll", 0xAA64)
            with self.assertRaisesRegex(SystemExit, "vcruntime140.dll.*ARM64"):
                windows_runtime.install_windows_crt(frozen, crt)
            self.assertEqual(original.read_bytes(), before)
            self.assertFalse((frozen / "_internal/vcruntime140.dll").exists())

    def test_missing_crt_is_not_silently_taken_from_build_machine(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_pe(root / "msvcp140.dll")
            with self.assertRaisesRegex(SystemExit, "missing.*vcruntime140"):
                windows_runtime.windows_crt_files(root)

    def test_rejects_non_x64_and_invalid_pe_files(self):
        for machine in [0x014C, 0xAA64, 0xA641, 0xA64E]:
            with self.subTest(machine=machine), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                write_pe(root / "library.PYD", machine)
                with self.assertRaisesRegex(SystemExit, "expected x64"):
                    windows_runtime.validate_windows_runtime(root)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for data in [b"not PE", b"MZ" + bytes(62), b"MZ" + bytes(58) + struct.pack("<I", 0xFFFFFFFF)]:
                (root / "broken.dll").write_bytes(data)
                with self.assertRaisesRegex(SystemExit, "invalid Windows PE"):
                    windows_runtime.validate_windows_runtime(root)

    def test_macos_preparation_keeps_its_native_binaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            frozen, media = root / "frozen", root / "media"
            frozen.mkdir()
            media.mkdir()
            (media / "ffmpeg").write_bytes(b"Mach-O fixture")
            build_runtime.prepare_frozen_runtime(frozen, media, "macos-arm64")
            self.assertEqual((frozen / "bin/ffmpeg").read_bytes(), b"Mach-O fixture")

    def test_layered_packager_rejects_arm_crt_before_running_media_tools(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ["video-editor-host.exe", "bin/ffmpeg.exe", "bin/ffprobe.exe"]:
                write_pe(root / name)
            write_pe(root / "_internal/numpy/_core/_multiarray_umath.cp314-win_amd64.pyd")
            write_pe(root / "_internal/vcruntime140.dll", 0xAA64)
            args = SimpleNamespace(
                runtime=root,
                target="windows-x86_64",
                allow_unsigned_runtime=True,
                distribution="internal-poc",
            )
            with self.assertRaisesRegex(SystemExit, "vcruntime140.dll.*ARM64"):
                package_layers.package_engine(args, SCRIPTS.parent, {}, False)

    def test_legacy_packager_rejects_arm_crt_before_model_checks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ["video-editor-module.exe", "bin/ffmpeg.exe", "bin/ffprobe.exe"]:
                write_pe(root / name)
            write_pe(root / "_internal/msvcp140.dll", 0xAA64)
            with self.assertRaisesRegex(SystemExit, "msvcp140.dll.*ARM64"):
                package_module.validate_runtime(root, "windows-x86_64", {}, True, "internal-poc")


if __name__ == "__main__":
    unittest.main()
