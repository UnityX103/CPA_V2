import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def load_script(name: str):
    path = ROOT / "scripts" / name
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


LAYERS = load_script("package_layers.py")
INDEX = load_script("build_layered_index.py")
ACCEPT = load_script("accept_runtime.py")


class LayeredContractTest(unittest.TestCase):
    def test_runtime_and_logic_are_independent_noncommercial_components(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / "electron-dist"
            runtime.mkdir()
            (runtime / "electron").write_bytes(b"runtime")
            source = root / "source"
            (source / "src").mkdir(parents=True)
            (source / "assets").mkdir()
            (source / "node_modules" / "electron-store").mkdir(parents=True)
            (source / "main.js").write_text("business", encoding="utf-8")
            (source / "package.json").write_text("{}", encoding="utf-8")
            (source / "package-lock.json").write_text("{}", encoding="utf-8")
            (source / "src" / "overlay.js").write_text("overlay", encoding="utf-8")
            (source / "assets" / "tray.png").write_bytes(b"tray")
            dependency = source / "node_modules" / "electron-store"
            (dependency / "index.js").write_text("dependency", encoding="utf-8")
            (dependency / "package.json").write_text(
                json.dumps({"name": "electron-store", "version": "8.2.0", "license": "MIT"}),
                encoding="utf-8",
            )
            (dependency / "license").write_text("MIT", encoding="utf-8")
            licenses = root / "licenses"
            licenses.mkdir()
            (licenses / "CockroachPet-MIT.txt").write_text("MIT", encoding="utf-8")
            (licenses / "NONCOMMERCIAL-NOTICE.md").write_text(
                "Non-commercial learning use", encoding="utf-8"
            )
            (licenses / "THIRD-PARTY-SOURCES.md").write_text(
                "Pinned sources", encoding="utf-8"
            )
            output = root / "output"

            runtime_archive, runtime_document = LAYERS.package_runtime(
                runtime_dir=runtime,
                entry="runtime/electron",
                target="macos-arm64",
                version="40.8.0",
                licenses=licenses,
                output_dir=output,
                release_url="https://github.com/UnityX103/CPA_V2/releases/download/v0.1.25",
                platform_validator=lambda *_: "verified-test-runtime",
            )
            dependency_archive, dependency_document = LAYERS.package_dependencies(
                source_dir=source,
                production_dependencies=[dependency],
                version="electron-store-8.2.0-lock-1",
                licenses=licenses,
                output_dir=output,
                release_url="https://github.com/UnityX103/CPA_V2/releases/download/v0.1.25",
            )
            logic_archive, logic_document = LAYERS.package_logic(
                source_dir=source,
                version="1.1.0-noncommercial.1",
                dependency_set=dependency_document["dependencySet"],
                licenses=licenses,
                output_dir=output,
                release_url="https://github.com/UnityX103/CPA_V2/releases/download/v0.1.25",
                source_verifier=lambda *_: None,
            )

            self.assertEqual(runtime_document["component"], "runtime")
            self.assertEqual(dependency_document["component"], "dependencies")
            self.assertEqual(logic_document["component"], "logic")
            self.assertFalse(runtime_document["releaseEligible"])
            self.assertEqual(runtime_document["distribution"], "noncommercial-open-source")
            self.assertEqual(logic_document["distribution"], "noncommercial-open-source")
            self.assertEqual(runtime_document["runtimeAbi"], logic_document["runtimeAbi"])
            self.assertEqual(dependency_document["dependencySet"], logic_document["dependencySet"])
            with zipfile.ZipFile(runtime_archive) as archive:
                names = set(archive.namelist())
                self.assertIn("runtime/electron", names)
                self.assertIn("runtime.json", names)
                self.assertNotIn("logic/main.js", names)
            with zipfile.ZipFile(logic_archive) as archive:
                names = set(archive.namelist())
                self.assertIn("logic/main.js", names)
                self.assertIn("module.json", names)
                module_manifest = json.loads(archive.read("module.json"))
                self.assertEqual(
                    module_manifest["runtimeContribution"],
                    LAYERS.CONTRACT["runtimeContribution"],
                )
                self.assertFalse(any(name.startswith("runtime/") for name in names))
                self.assertFalse(any("node_modules/" in name for name in names))
            with zipfile.ZipFile(dependency_archive) as archive:
                names = set(archive.namelist())
                self.assertIn("dependencies/node_modules/electron-store/index.js", names)
                self.assertIn("dependencies.json", names)
                inventory = json.loads(archive.read("licenses/JS-PACKAGE-LICENSES.json"))
                self.assertEqual(inventory[0]["name"], "electron-store")

            receipt = root / "receipt.json"
            receipt.write_text(json.dumps({
                "schemaVersion": 1,
                "component": "runtime",
                "target": "macos-arm64",
                "version": "40.8.0",
                "runtimeAbi": runtime_document["runtimeAbi"],
                "artifactSha256": runtime_document["sha256"],
                "checks": {
                    "allMachOThin": True,
                    "codesignValid": True,
                    "versionLaunch": True,
                    "logicLaunch": True,
                },
            }), encoding="utf-8")
            accepted = ACCEPT.accept_runtime(
                runtime_archive.with_suffix(".component.json"), runtime_archive, receipt
            )
            self.assertTrue(accepted["releaseEligible"])
            self.assertEqual(accepted["acceptanceReceiptSha256"], LAYERS.sha256(receipt))

    def test_index_reuses_runtime_documents_from_older_releases(self):
        artifact = lambda component, version, target, tag, marker: {
            "component": component,
            "version": version,
            "target": target,
            "distribution": "noncommercial-open-source",
            "packageAuthenticity": "tauri-minisign-index+sha256",
            "publicIndexSignatureRequired": True,
            "releaseEligible": True,
            "runtimeAbi": "cpa-cockroach-electron-40-control-v1",
            "manifestSha256": marker * 64,
            "url": f"https://github.com/UnityX103/CPA_V2/releases/download/{tag}/{component}-{target or 'shared'}.zip",
            "sha256": marker * 64,
            "size": 42,
            **({"acceptanceReceiptSha256": "f" * 64} if component == "runtime" else {}),
        }
        logic = artifact("logic", "1.2.0-noncommercial.1", None, "v0.1.25", "a")
        dependencies = artifact("dependencies", "electron-store-8.2.0-lock-1", None, "v0.1.24", "e")
        dependencies["dependencySet"] = "cockroach-js-lock-1"
        logic["dependencySet"] = dependencies["dependencySet"]
        runtimes = [
            artifact("runtime", "40.8.0", target, "v0.1.24", marker)
            for target, marker in [
                ("macos-arm64", "b"),
                ("macos-x86_64", "c"),
                ("windows-x86_64", "d"),
            ]
        ]
        unaccepted_runtime = dict(runtimes[0])
        unaccepted_runtime.pop("acceptanceReceiptSha256")
        with self.assertRaisesRegex(ValueError, "acceptance receipt"):
            INDEX.build_index(
                "1.2.0-noncommercial.1",
                [logic, dependencies, unaccepted_runtime, *runtimes[1:]],
            )
        index = INDEX.build_index("1.2.0-noncommercial.1", [logic, dependencies, *runtimes])
        self.assertEqual(index["schemaVersion"], 2)
        self.assertEqual(index["distribution"], "noncommercial-open-source")
        self.assertEqual(index["logic"]["version"], "1.2.0-noncommercial.1")
        self.assertEqual(index["dependencies"]["version"], "electron-store-8.2.0-lock-1")
        self.assertIn("/download/v0.1.24/", index["runtimes"]["macos-arm64"]["url"])
        self.assertEqual(set(index["runtimes"]), LAYERS.TARGETS)


if __name__ == "__main__":
    unittest.main()
