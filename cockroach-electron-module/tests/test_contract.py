import json
import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path
import importlib.util
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "package_module.py"
SPEC = importlib.util.spec_from_file_location("package_module", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)
PREPARE_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "prepare_source.py"
PREPARE_SPEC = importlib.util.spec_from_file_location("prepare_source", PREPARE_SCRIPT)
PREPARE = importlib.util.module_from_spec(PREPARE_SPEC)
assert PREPARE_SPEC.loader is not None
PREPARE_SPEC.loader.exec_module(PREPARE)


class ContractTest(unittest.TestCase):
    def test_packages_every_supported_runtime_contract(self):
        cases = [
            (
                "macos-arm64",
                "CockroachPet.app",
                "Contents/MacOS/CockroachPet",
                "runtime/CockroachPet.app/Contents/MacOS/CockroachPet",
            ),
            (
                "macos-x86_64",
                "CockroachPet.app",
                "Contents/MacOS/CockroachPet",
                "runtime/CockroachPet.app/Contents/MacOS/CockroachPet",
            ),
            (
                "windows-x86_64",
                "win-unpacked",
                "CockroachPet.exe",
                "runtime/win-unpacked/CockroachPet.exe",
            ),
        ]
        for target, runtime_name, executable_path, entry_path in cases:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / "source"
                source.mkdir()
                runtime = root / runtime_name
                entry = runtime / executable_path
                entry.parent.mkdir(parents=True)
                entry.write_text("runtime", encoding="utf-8")
                with mock.patch.object(MODULE, "verify_patched_source"), \
                        mock.patch.object(MODULE, "verify_packaged_runtime"):
                    archive = MODULE.package(
                        runtime,
                        source,
                        entry_path,
                        target,
                        "1.1.0",
                        root / "dist",
                    )
                with zipfile.ZipFile(archive) as bundle:
                    manifest = json.loads(bundle.read("module.json"))
                    self.assertEqual(manifest["id"], "cpa-cockroach-electron")
                    self.assertEqual(manifest["target"], target)
                    self.assertEqual(manifest["entry"], entry_path)
                    self.assertEqual(manifest["upstream"]["commit"], "a7d103d2818b40e12b8a39948e9ebf4c6085bfd3")
                    self.assertIn("process-lifecycle", manifest["capabilities"])
                    self.assertIn("licenses/CockroachPet-MIT.txt", bundle.namelist())

    def test_rejects_unsafe_entry(self):
        with self.assertRaises(ValueError):
            MODULE.validate_relative_entry("../outside")

    def test_source_verifier_requires_the_exact_reviewed_adapter(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            main = source / "main.js"
            overlay = source / "src/overlay/overlay.js"
            overlay.parent.mkdir(parents=True)
            main.write_text("reviewed-main", encoding="utf-8")
            overlay.write_text("reviewed-overlay", encoding="utf-8")
            hashes = {
                "main.js": hashlib.sha256(b"reviewed-main").hexdigest(),
                "src/overlay/overlay.js": hashlib.sha256(b"reviewed-overlay").hexdigest(),
            }
            with mock.patch.object(MODULE, "PATCHED_SOURCE_HASHES", hashes), \
                    mock.patch.object(
                        MODULE.subprocess,
                        "check_output",
                        side_effect=[
                            MODULE.UPSTREAM_COMMIT + "\n",
                            " M main.js\n M src/overlay/overlay.js\n",
                            MODULE.UPSTREAM_COMMIT + "\n",
                            " M main.js\n M src/overlay/overlay.js\n",
                        ],
                    ):
                MODULE.verify_patched_source(source)
                overlay.write_text("tampered", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "does not match"):
                    MODULE.verify_patched_source(source)

    def test_runtime_verifier_reads_the_reviewed_files_from_app_asar(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source"
            runtime = source / "dist" / "mac-arm64" / "CockroachPet.app"
            asar = runtime / "Contents/Resources/app.asar"
            asar.parent.mkdir(parents=True)
            asar.write_bytes(b"asar")
            asar_script = source / "node_modules/@electron/asar/bin/asar.js"
            asar_script.parent.mkdir(parents=True)
            asar_script.write_text("asar", encoding="utf-8")
            hashes = {
                "main.js": hashlib.sha256(b"reviewed-main").hexdigest(),
                "src/overlay/overlay.js": hashlib.sha256(b"reviewed-overlay").hexdigest(),
            }

            def extract(_args, *, check, stdout, stderr, text):
                self.assertTrue(check and text)
                extracted = Path(_args[-1])
                (extracted / "src/overlay").mkdir(parents=True)
                (extracted / "main.js").write_bytes(b"reviewed-main")
                (extracted / "src/overlay/overlay.js").write_bytes(b"reviewed-overlay")
                return mock.Mock(returncode=0)

            with mock.patch.object(MODULE, "PATCHED_SOURCE_HASHES", hashes), \
                    mock.patch.object(MODULE.shutil, "which", return_value="node"), \
                    mock.patch.object(MODULE.subprocess, "run", side_effect=extract):
                MODULE.verify_packaged_runtime(runtime, source, "macos-arm64")

    def test_source_adapter_writes_canonical_lf_on_every_platform(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            overlay = source / "src/overlay/overlay.js"
            overlay.parent.mkdir(parents=True)
            (source / "main.js").write_bytes(
                b"let tray = null;\r\n"
                b"  startCursorPolling();\r\n  startHitTestPolling();\r\n"
                b"app.on('will-quit', () => {\r\n  globalShortcut.unregisterAll();\r\n"
            )
            overlay.write_bytes(
                b"ipcRenderer.on('kill-all', () => {\r\n  manager.killAll();\r\n});"
            )
            with mock.patch.object(
                PREPARE.subprocess,
                "check_output",
                side_effect=[PREPARE.UPSTREAM_COMMIT + "\n", ""],
            ):
                PREPARE.prepare(source)
            self.assertNotIn(b"\r\n", (source / "main.js").read_bytes())
            self.assertNotIn(b"\r\n", overlay.read_bytes())


if __name__ == "__main__":
    unittest.main()
