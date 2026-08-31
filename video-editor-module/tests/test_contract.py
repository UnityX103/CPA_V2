from __future__ import annotations

import importlib.util
import hashlib
import http.server
import json
import subprocess
import sys
import tempfile
import threading
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


def load_packager():
    spec = importlib.util.spec_from_file_location(
        "video_editor_packager", ROOT / "scripts" / "package_module.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
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
        self.assertIn("signed module index", policy["publicPackageAuthenticity"])

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
        self.assertEqual(
            release["packages"]["windows-x86_64"]["platformSignature"],
            "unsigned-index-authenticated",
        )
        self.assertIn("ffmpegSourceSha256", release["ffmpeg"]["windows"])
        self.assertIn("libvpxSourceSha256", release["ffmpeg"]["windows"])

    def test_public_license_pack_requires_provenance_and_component_notices(self):
        packager = load_packager()
        distribution = packager.DISTRIBUTION_POLICIES["noncommercial-open-source"]
        source_policy = json.loads((ROOT / "source-policy.json").read_text(encoding="utf-8"))
        required_packages = packager.required_python_packages(ROOT, "macos-arm64")
        source_manifest = load_build_runtime().source_manifest_document(
            source_policy,
            "macos-arm64",
            "a" * 40,
            "--enable-libvpx",
            "CPython",
            "3.14.7",
        )
        with tempfile.TemporaryDirectory() as temporary:
            licenses = Path(temporary)
            required = {
                "NONCOMMERCIAL-NOTICE.md": "noncommercial",
                "THIRD-PARTY-SOURCES.md": "sources",
                "PYTHON-LICENSE.txt": "python",
                "PYTHON-PACKAGE-LICENSES.json": json.dumps([
                    {"Name": name, "Version": "1.0.0", "License": "test-license"}
                    for name in sorted(required_packages)
                ]),
                "FFMPEG-LICENSE.txt": "lgpl",
                "FFMPEG-CONFIGURATION.txt": "--enable-libvpx",
                "LIBVPX-LICENSE.txt": "bsd",
                "LIBVPX-PATENTS.txt": "patents",
                "SOURCE-MANIFEST.json": json.dumps(source_manifest),
            }
            for name, contents in required.items():
                (licenses / name).write_text(contents, encoding="utf-8")
            manifest = packager.validate_license_pack(
                licenses,
                "macos-arm64",
                distribution,
                source_policy,
                "--enable-libvpx",
                required_packages,
            )
            self.assertEqual(manifest["target"], "macos-arm64")

            (licenses / "LIBVPX-LICENSE.txt").unlink()
            with self.assertRaisesRegex(SystemExit, "LIBVPX-LICENSE.txt"):
                packager.validate_license_pack(
                    licenses,
                    "macos-arm64",
                    distribution,
                    source_policy,
                    "--enable-libvpx",
                    required_packages,
                )

            (licenses / "LIBVPX-LICENSE.txt").write_text("bsd", encoding="utf-8")
            tampered = json.loads((licenses / "SOURCE-MANIFEST.json").read_text(encoding="utf-8"))
            tampered["components"]["sam2"]["checkpointSha256"] = "0" * 64
            (licenses / "SOURCE-MANIFEST.json").write_text(json.dumps(tampered), encoding="utf-8")
            with self.assertRaisesRegex(SystemExit, "SAM2.checkpointSha256"):
                packager.validate_license_pack(
                    licenses,
                    "macos-arm64",
                    distribution,
                    source_policy,
                    "--enable-libvpx",
                    required_packages,
                )

            tampered = json.loads((licenses / "PYTHON-PACKAGE-LICENSES.json").read_text())
            tampered = [item for item in tampered if item["Name"] != "sam-2"]
            (licenses / "PYTHON-PACKAGE-LICENSES.json").write_text(
                json.dumps(tampered), encoding="utf-8"
            )
            (licenses / "SOURCE-MANIFEST.json").write_text(
                json.dumps(source_manifest), encoding="utf-8"
            )
            with self.assertRaisesRegex(SystemExit, "sam-2"):
                packager.validate_license_pack(
                    licenses,
                    "macos-arm64",
                    distribution,
                    source_policy,
                    "--enable-libvpx",
                    required_packages,
                )

    def test_noncommercial_windows_signature_policy_is_explicit(self):
        packager = load_packager()
        policy = packager.DISTRIBUTION_POLICIES["noncommercial-open-source"]
        self.assertEqual(policy.windows_signature, "authenticode-or-signed-index")
        script = (ROOT / "scripts" / "package_module.py").read_text(encoding="utf-8")
        self.assertIn("unsigned-index-authenticated", script)
        self.assertNotIn('if distribution == "noncommercial-open-source":\n            return', script)

    def test_model_download_cache_survives_runtime_output_replacement(self):
        script = (ROOT / "scripts" / "build_runtime.py").read_text(encoding="utf-8")
        self.assertIn('model_cache = work / "model-cache"', script)
        self.assertIn('headers={"Range": f"bytes={offset}-"}', script)
        self.assertIn("shutil.copy2(sam_cached, sam_target)", script)

    def test_model_download_resumes_a_partial_http_range(self):
        build_runtime = load_build_runtime()
        payload = (b"resume-model-download-" * 1024) + b"done"

        class RangeHandler(http.server.BaseHTTPRequestHandler):
            requested_ranges: list[str | None] = []

            def do_GET(self):
                range_header = self.headers.get("Range")
                self.requested_ranges.append(range_header)
                start = int(range_header.removeprefix("bytes=").removesuffix("-"))
                self.send_response(206)
                self.send_header("Content-Length", str(len(payload) - start))
                self.send_header("Content-Range", f"bytes {start}-{len(payload) - 1}/{len(payload)}")
                self.end_headers()
                self.wfile.write(payload[start:])

            def log_message(self, _format, *_args):
                return

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), RangeHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temporary:
                target = Path(temporary) / "model.bin"
                partial = target.with_suffix(".bin.download")
                partial.write_bytes(payload[:128])
                build_runtime.download(
                    f"http://127.0.0.1:{server.server_port}/model.bin",
                    target,
                    hashlib.sha256(payload).hexdigest(),
                )
                self.assertEqual(target.read_bytes(), payload)
                self.assertEqual(RangeHandler.requested_ranges, ["bytes=128-"])
                self.assertFalse(partial.exists())
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_model_download_promotes_a_complete_partial_without_http(self):
        build_runtime = load_build_runtime()
        payload = b"already-complete-model"
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "model.bin"
            partial = target.with_suffix(".bin.download")
            partial.write_bytes(payload)
            build_runtime.download(
                "http://127.0.0.1:1/must-not-be-requested",
                target,
                hashlib.sha256(payload).hexdigest(),
            )
            self.assertEqual(target.read_bytes(), payload)
            self.assertFalse(partial.exists())

    def test_release_runtime_source_commit_rejects_dirty_inputs(self):
        build_runtime = load_build_runtime()
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary)
            subprocess.run(["git", "init", "-q"], cwd=repository, check=True)
            subprocess.run(
                ["git", "config", "user.email", "tests@example.invalid"],
                cwd=repository,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Video Module Tests"],
                cwd=repository,
                check=True,
            )
            source = repository / "source.py"
            source.write_text("clean = True\n", encoding="utf-8")
            subprocess.run(["git", "add", "source.py"], cwd=repository, check=True)
            subprocess.run(["git", "commit", "-q", "-m", "fixture"], cwd=repository, check=True)
            self.assertRegex(build_runtime.clean_source_commit(repository), r"^[0-9a-f]{40}$")

            source.write_text("clean = False\n", encoding="utf-8")
            with self.assertRaisesRegex(SystemExit, "source is dirty"):
                build_runtime.clean_source_commit(repository)

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
                        "distribution": "noncommercial-open-source",
                        "platformSignature": (
                            "unsigned-index-authenticated"
                            if target == "windows-x86_64"
                            else "ad-hoc"
                        ),
                        "packageAuthenticity": "tauri-minisign-index+sha256",
                        "publicIndexSignatureRequired": True,
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
            self.assertEqual(document["distribution"], "noncommercial-open-source")
            self.assertEqual(
                document["packages"]["windows-x86_64"]["platformSignature"],
                "unsigned-index-authenticated",
            )

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
