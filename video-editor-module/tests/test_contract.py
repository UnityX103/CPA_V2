from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_pipeline():
    spec = importlib.util.spec_from_file_location(
        "video_editor_pipeline", ROOT / "video_editor_module" / "pipeline.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_build_runtime():
    spec = importlib.util.spec_from_file_location(
        "video_editor_build_runtime", ROOT / "scripts" / "build_runtime.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class VideoEditorModuleContractTests(unittest.TestCase):
    def test_runtime_target_uses_python_architecture_on_windows_arm_host(self):
        build_runtime = load_build_runtime()
        self.assertEqual(
            build_runtime.target_from_platform("Windows", "ARM64", "win-amd64"),
            "windows-x86_64",
        )
        self.assertEqual(
            build_runtime.target_from_platform("Darwin", "arm64", "macosx-14-arm64"),
            "macos-arm64",
        )

    def test_ui_keeps_screenshot_and_resolution_without_region_drawing(self):
        html = (ROOT / "video_editor_module" / "static" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "video_editor_module" / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn("截取当前帧", html)
        self.assertIn("输出分辨率", html)
        self.assertIn("resolution-preset", html)
        self.assertIn("toBlob", javascript)
        for removed in ["裁剪工具", "画笔剔除", "crop-box", "brush-overlay"]:
            self.assertNotIn(removed, html + javascript)

    def test_source_policy_allows_only_noncommercial_open_source_release(self):
        policy = json.loads((ROOT / "source-policy.json").read_text(encoding="utf-8"))
        self.assertFalse(policy["commercialReleaseAllowed"])
        self.assertTrue(policy["nonCommercialOpenSourceReleaseAllowed"])
        self.assertIn("PPM-100", policy["components"]["birefnet"]["provenanceRisk"])
        self.assertIn("--enable-gpl", policy["components"]["ffmpeg"]["forbiddenConfigureFlags"])
        self.assertIn("hevc_videotoolbox", policy["components"]["ffmpeg"]["macosRequiredEncoders"])

        build_script = (ROOT / "scripts" / "build_runtime.py").read_text(encoding="utf-8")
        self.assertIn("sam_policy['commit']", build_script)
        self.assertTrue((ROOT / "requirements.macos-x86_64.lock.txt").is_file())

        html = (ROOT / "video_editor_module" / "static" / "index.html").read_text(
            encoding="utf-8"
        )
        self.assertIn("仅限非商业开源学习与研究", html)
        self.assertIn("CC BY-NC-SA 4.0", html)

        notice = (ROOT / "licenses" / "NONCOMMERCIAL-NOTICE.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("BiRefNet-matting", notice)
        self.assertIn("PPM-100", notice)
        self.assertIn("CC BY-NC-SA 4.0", notice)

        release = json.loads(
            (ROOT / "RELEASE_MANIFEST_1.0.0-noncommercial.1.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(release["distribution"], "noncommercial-open-source")
        self.assertEqual(
            set(release["packages"]),
            {"macos-arm64", "macos-x86_64", "windows-x86_64"},
        )

    def test_macos_preview_uses_hevc_alpha_while_download_stays_webm(self):
        pipeline = (ROOT / "video_editor_module" / "pipeline.py").read_text(encoding="utf-8")
        server = (ROOT / "video_editor_module" / "server.py").read_text(encoding="utf-8")
        javascript = (ROOT / "video_editor_module" / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn("hevc_videotoolbox", pipeline)
        self.assertIn('if parsed.path == "/api/preview"', server)
        self.assertIn("api(previewUrl)", javascript)
        self.assertIn("downloadOutput.href = outputUrl", javascript)
        self.assertIn('platform.machine().lower() in {"arm64", "aarch64"}', pipeline)

    def test_resolution_is_even_bounded_and_preserves_aspect_when_one_axis_is_automatic(self):
        pipeline = load_pipeline()
        self.assertEqual(pipeline.normalize_resolution(1008, 720, 720, 0), (720, 514))
        self.assertEqual(pipeline.normalize_resolution(1008, 720, 0, 720), (1008, 720))
        self.assertEqual(pipeline.normalize_resolution(1008, 720, 5001, 5001), (4096, 4096))

    def test_release_index_requires_every_supported_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package_paths = []
            for target in ["macos-arm64", "macos-x86_64", "windows-x86_64"]:
                path = root / f"video-editor-module-1.0.0-{target}.package.json"
                path.write_text(
                    json.dumps({
                        "target": target,
                        "version": "1.0.0",
                        "url": f"https://github.com/example/{target}.zip",
                        "sha256": "a" * 64,
                        "size": 42,
                        "releaseEligible": True,
                    }),
                    encoding="utf-8",
                )
                package_paths.append(path)
            output = root / "video-editor-module-index.json"
            subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "build_index.py"),
                    "--version",
                    "1.0.0",
                    "--output",
                    str(output),
                    *(str(path) for path in package_paths),
                ],
                check=True,
                stdout=subprocess.PIPE,
            )
            document = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(set(document["packages"]), {
                "macos-arm64", "macos-x86_64", "windows-x86_64",
            })
            self.assertFalse(document["debugOnly"])

            blocked = json.loads(package_paths[0].read_text(encoding="utf-8"))
            blocked["releaseEligible"] = False
            package_paths[0].write_text(json.dumps(blocked), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "build_index.py"),
                    "--version",
                    "1.0.0",
                    "--output",
                    str(output),
                    *(str(path) for path in package_paths),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"not eligible", result.stderr)


if __name__ == "__main__":
    unittest.main()
