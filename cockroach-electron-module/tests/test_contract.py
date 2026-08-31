import json
import tempfile
import unittest
import zipfile
from pathlib import Path
import importlib.util

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "package_module.py"
SPEC = importlib.util.spec_from_file_location("package_module", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ContractTest(unittest.TestCase):
    def test_packages_runtime_manifest_and_license(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / "CockroachPet.app"
            entry = runtime / "Contents" / "MacOS" / "CockroachPet"
            entry.parent.mkdir(parents=True)
            entry.write_text("runtime", encoding="utf-8")
            archive = MODULE.package(
                runtime,
                "runtime/CockroachPet.app/Contents/MacOS/CockroachPet",
                "macos-arm64",
                "1.1.0",
                root / "dist",
            )
            with zipfile.ZipFile(archive) as bundle:
                manifest = json.loads(bundle.read("module.json"))
                self.assertEqual(manifest["id"], "cpa-cockroach-electron")
                self.assertEqual(manifest["upstream"]["commit"], "a7d103d2818b40e12b8a39948e9ebf4c6085bfd3")
                self.assertIn("process-lifecycle", manifest["capabilities"])
                self.assertIn("licenses/CockroachPet-MIT.txt", bundle.namelist())

    def test_rejects_unsafe_entry(self):
        with self.assertRaises(ValueError):
            MODULE.validate_relative_entry("../outside")


if __name__ == "__main__":
    unittest.main()
