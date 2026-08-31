import json
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
                (source / "main.js").write_text(
                    "const CPA_CONTROL_PROTOCOL_VERSION = 1; // --cpa-control-file=",
                    encoding="utf-8",
                )
                runtime = root / runtime_name
                entry = runtime / executable_path
                entry.parent.mkdir(parents=True)
                entry.write_text("runtime", encoding="utf-8")
                with mock.patch.object(
                    MODULE.subprocess,
                    "check_output",
                    side_effect=[MODULE.UPSTREAM_COMMIT + "\n", "main.js\n"],
                ):
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

    def test_rejects_an_unpatched_upstream_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "main.js").write_text("upstream", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "control-file integration patch"):
                MODULE.verify_patched_source(source)


if __name__ == "__main__":
    unittest.main()
