from __future__ import annotations

import importlib.util
import hashlib
import http.server
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile
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


def load_layer_packager():
    scripts = ROOT / "scripts"
    sys.path.insert(0, str(scripts))
    try:
        spec = importlib.util.spec_from_file_location(
            "video_editor_layer_packager", scripts / "package_layers.py"
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(scripts))


class VideoEditorModuleContractTests(unittest.TestCase):
    def test_layered_host_loads_business_code_from_an_external_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / "video_editor_module"
            package.mkdir()
            (package / "__init__.py").write_text("", encoding="utf-8")
            (package / "__main__.py").write_text(
                "import json,os,sys\n"
                "open(os.environ['HOST_RESULT'], 'w').write(json.dumps(sys.argv[1:]))\n",
                encoding="utf-8",
            )
            result = root / "result.json"
            subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "video_editor_host.py"),
                    "--logic-root",
                    str(root),
                    "--serve",
                    "--port",
                    "18771",
                ],
                env={**dict(__import__("os").environ), "HOST_RESULT": str(result)},
                check=True,
            )
            self.assertEqual(
                json.loads(result.read_text(encoding="utf-8")),
                ["--serve", "--port", "18771"],
            )

    def test_external_model_root_overrides_the_legacy_runtime_layout(self):
        pipeline = load_pipeline()
        os_module = __import__("os")
        previous = os_module.environ.get("CPA_VIDEO_EDITOR_MODEL_ROOT")
        try:
            os_module.environ["CPA_VIDEO_EDITOR_MODEL_ROOT"] = "/tmp/cpa-model-layer"
            self.assertEqual(
                pipeline.model_root(Path("/tmp/legacy-runtime")),
                Path("/tmp/cpa-model-layer").resolve(),
            )
        finally:
            if previous is None:
                os_module.environ.pop("CPA_VIDEO_EDITOR_MODEL_ROOT", None)
            else:
                os_module.environ["CPA_VIDEO_EDITOR_MODEL_ROOT"] = previous
        self.assertEqual(
            pipeline.model_root(Path("/tmp/legacy-runtime")),
            Path("/tmp/legacy-runtime/models"),
        )

    def test_logic_package_is_independent_from_runtime_and_models(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "package_layers.py"),
                    "logic",
                    "--version",
                    "1.3.0-noncommercial.1",
                    "--source",
                    str(ROOT / "video_editor_module"),
                    "--licenses",
                    str(ROOT / "licenses"),
                    "--output-dir",
                    str(output),
                    "--release-url",
                    "https://github.com/UnityX103/CPA_V2/releases/download/v0.1.26",
                    "--distribution",
                    "noncommercial-open-source",
                ],
                check=True,
                stdout=subprocess.PIPE,
            )
            archive = output / "video-editor-logic-1.3.0-noncommercial.1.zip"
            metadata = json.loads(
                archive.with_suffix(".component.json").read_text(encoding="utf-8")
            )
            with zipfile.ZipFile(archive) as package:
                names = set(package.namelist())
                manifest = json.loads(package.read("module.json"))
            self.assertEqual(metadata["component"], "logic")
            self.assertEqual(metadata["engineAbi"], "cpa-video-engine-1")
            self.assertEqual(metadata["modelSet"], "sam2-baseplus-birefnet-1")
            self.assertEqual(len(metadata["manifestSha256"]), 64)
            self.assertIn("module.json", names)
            self.assertIn("video_editor_module/__main__.py", names)
            self.assertFalse(any(name.startswith("runtime/") for name in names))
            self.assertFalse(any(name.startswith("models/") for name in names))
            self.assertIn(
                "video_editor_module/__main__.py",
                {item["path"] for item in manifest["files"]},
            )

    def test_models_package_requires_pinned_source_provenance(self):
        packager = load_layer_packager()
        policy = json.loads((ROOT / "source-policy.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            licenses = Path(temporary)
            for name in ["NONCOMMERCIAL-NOTICE.md", "THIRD-PARTY-SOURCES.md"]:
                (licenses / name).write_text("fixture", encoding="utf-8")
            with self.assertRaisesRegex(SystemExit, "SOURCE-MANIFEST.json"):
                packager.validate_models_license_pack(
                    licenses, policy, "noncommercial-open-source"
                )

    def test_layered_index_versions_each_component_independently(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            documents = []
            for component, target, version, marker in [
                ("logic", None, "1.3.0", "a"),
                ("models", None, "1.0.0", "b"),
                ("engine", "macos-arm64", "1.0.0", "c"),
                ("engine", "macos-x86_64", "1.0.0", "d"),
                ("engine", "windows-x86_64", "1.0.0", "e"),
            ]:
                path = root / f"{component}-{target or 'common'}.component.json"
                document = {
                    "component": component,
                    "version": version,
                    "url": f"https://github.com/UnityX103/CPA_V2/releases/download/v2/{path.stem}.zip",
                    "sha256": marker * 64,
                    "manifestSha256": marker * 64,
                    "size": 42,
                    "distribution": "noncommercial-open-source",
                    "packageAuthenticity": "tauri-minisign-index+sha256",
                    "publicIndexSignatureRequired": True,
                    "releaseEligible": True,
                }
                if target:
                    document["target"] = target
                    document["platformSignature"] = "ad-hoc"
                    document["engineAbi"] = "cpa-video-engine-1"
                elif component == "models":
                    document["modelSet"] = "sam2-baseplus-birefnet-1"
                else:
                    document["engineAbi"] = "cpa-video-engine-1"
                    document["modelSet"] = "sam2-baseplus-birefnet-1"
                path.write_text(json.dumps(document), encoding="utf-8")
                documents.append(path)
            output = root / "video-editor-module-index.json"
            subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "build_layered_index.py"),
                    "--version",
                    "1.3.0",
                    "--output",
                    str(output),
                    *(str(path) for path in documents),
                ],
                check=True,
                stdout=subprocess.PIPE,
            )
            index = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(index["schemaVersion"], 2)
            self.assertEqual(index["logic"]["version"], "1.3.0")
            self.assertEqual(index["models"]["version"], "1.0.0")
            self.assertEqual(index["logic"]["engineAbi"], "cpa-video-engine-1")
            self.assertEqual(index["logic"]["modelSet"], "sam2-baseplus-birefnet-1")
            self.assertEqual(
                set(index["engines"]),
                {"macos-arm64", "macos-x86_64", "windows-x86_64"},
            )

            incompatible = json.loads(documents[-1].read_text(encoding="utf-8"))
            incompatible["engineAbi"] = "cpa-video-engine-2"
            documents[-1].write_text(json.dumps(incompatible), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "build_layered_index.py"),
                    "--version",
                    "1.3.0",
                    "--output",
                    str(output),
                    *(str(path) for path in documents),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"engineAbi", result.stderr)

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
        self.assertIn("applySourceDefaults();", javascript)
        self.assertIn("endInput.value = String(duration);", javascript)
        self.assertIn("widthInput.value = sourceProbe.width;", javascript)
        self.assertIn("heightInput.value = sourceProbe.height;", javascript)
        for control in [
            "subject-mode-auto",
            "subject-mode-point",
            "subject-marker",
            "background-cutoff",
            "seed-threshold",
            "core-threshold",
            "support-radius",
            "feather-sigma",
            "reset-matting-parameters",
        ]:
            self.assertIn(control, html + javascript)
        self.assertIn("subjectSelection", javascript)
        self.assertIn("mattingParameters", javascript)
        for removed in ["裁剪工具", "画笔剔除", "crop-box", "brush-overlay"]:
            self.assertNotIn(removed, html + javascript)

    def test_source_policy_allows_only_noncommercial_open_source_release(self):
        policy = json.loads((ROOT / "source-policy.json").read_text(encoding="utf-8"))
        self.assertFalse(policy["commercialReleaseAllowed"])
        self.assertTrue(policy["nonCommercialOpenSourceReleaseAllowed"])
        self.assertIn("PPM-100", policy["components"]["birefnet"]["provenanceRisk"])
        self.assertIn("--enable-gpl", policy["components"]["ffmpeg"]["forbiddenConfigureFlags"])
        self.assertIn("hevc_videotoolbox", policy["components"]["ffmpeg"]["macosRequiredEncoders"])
        self.assertIn("libvpx-vp9", policy["components"]["ffmpeg"]["requiredEncoders"])
        self.assertIn("signed module index", policy["publicPackageAuthenticity"])
        contract = json.loads((ROOT / "module-contract.json").read_text(encoding="utf-8"))
        self.assertEqual(contract["pipeline"], policy["pipeline"])
        self.assertIn("subject-point-selection", contract["capabilities"])
        self.assertIn("matting-parameters-v1", contract["capabilities"])
        self.assertIn("vp9-alpha-webm", contract["capabilities"])
        self.assertIn("masked-transparent-rgb-v1", contract["capabilities"])

        build_script = (ROOT / "scripts" / "build_runtime.py").read_text(encoding="utf-8")
        self.assertIn("sam_policy['commit']", build_script)
        self.assertTrue((ROOT / "requirements.macos-x86_64.lock.txt").is_file())

        html = (ROOT / "video_editor_module" / "static" / "index.html").read_text(
            encoding="utf-8"
        )
        self.assertNotIn('class="noncommercial-notice"', html)

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

    def test_windows_source_manifest_uses_packager_field_names(self):
        build_runtime = load_build_runtime()
        source_policy = json.loads((ROOT / "source-policy.json").read_text(encoding="utf-8"))
        manifest = build_runtime.source_manifest_document(
            source_policy,
            "windows-x86_64",
            "a" * 40,
            "configuration",
            "CPython",
            "3.14.7",
        )
        windows = source_policy["components"]["ffmpeg"]["windowsBuild"]
        self.assertEqual(manifest["components"]["ffmpeg"]["commit"], windows["ffmpegCommit"])
        self.assertEqual(
            manifest["components"]["ffmpeg"]["sourceSha256"],
            windows["ffmpegSourceSha256"],
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
        self.assertIn('choices=["legacy", "layered"]', script)
        self.assertIn('project_root / "video_editor_host.spec"', script)
        host_spec = (ROOT / "video_editor_host.spec").read_text(encoding="utf-8")
        self.assertNotIn("video_editor_module/static", host_spec)

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
        html = (ROOT / "video_editor_module" / "static" / "index.html").read_text(encoding="utf-8")
        javascript = (ROOT / "video_editor_module" / "static" / "app.js").read_text(encoding="utf-8")
        self.assertIn("hevc_videotoolbox", pipeline)
        self.assertIn('"libvpx-vp9", "-i", str(source)', pipeline)
        self.assertIn('if parsed.path == "/api/preview"', server)
        self.assertIn('first_query(parsed, "download") == "1"', server)
        self.assertIn("resultVideo.src = previewUrl", javascript)
        self.assertNotIn("resultObjectUrl", javascript)
        self.assertIn("downloadOutput.href = outputUrl", javascript)
        self.assertIn("downloadPreview.href = previewDownloadUrl", javascript)
        self.assertIn("const previewDownloadUrl", javascript)
        self.assertIn("downloadOutput.download = `pet-transparent-${id}.webm`", javascript)
        self.assertRegex(html, r'<a id="download-output"[^>]*\bdownload\b')
        self.assertRegex(html, r'<a id="download-preview"[^>]*\bdownload\b')
        self.assertIn("job.settings?.mattingParameters", javascript)
        self.assertIn('"settings": self.settings', server)
        self.assertIn('"version": __version__', server)
        self.assertIn('platform.machine().lower() in {"arm64", "aarch64"}', pipeline)

    def test_webm_encoder_uses_high_quality_vp9_and_clears_hidden_background_rgb(self):
        pipeline = (ROOT / "video_editor_module" / "pipeline.py").read_text(encoding="utf-8")
        self.assertIn('"-c:v", "libvpx-vp9"', pipeline)
        self.assertIn('"-crf", "18"', pipeline)
        self.assertIn('"-row-mt", "1"', pipeline)
        self.assertIn("maskedmerge", pipeline)
        self.assertIn("gt(val,16)", pipeline)
        self.assertIn("format=rgb24[mask]", pipeline)
        self.assertNotIn('"-c:v", "libvpx", "-deadline", "good"', pipeline)

        html = (ROOT / "video_editor_module" / "static" / "index.html").read_text(
            encoding="utf-8"
        )
        javascript = (ROOT / "video_editor_module" / "static" / "app.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("VP9 Alpha WebM", html + javascript)
        self.assertIn('id="download-preview"', html)

    def test_webm_encoder_preserves_visible_rgb_color(self):
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg is None:
            self.skipTest("ffmpeg is required for the VP9 color regression")

        pipeline = load_pipeline()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            frames = root / "frames"
            masks = root / "masks"
            runtime = root / "runtime"
            frames.mkdir()
            masks.mkdir()
            (runtime / "bin").mkdir(parents=True)
            (runtime / "bin" / "ffmpeg").symlink_to(ffmpeg)

            subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=0xd06020:s=64x64:r=1",
                    "-frames:v",
                    "1",
                    str(frames / "000001.png"),
                ],
                check=True,
            )
            subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=white:s=64x64:r=1",
                    "-frames:v",
                    "1",
                    str(masks / "000001.png"),
                ],
                check=True,
            )

            output = root / "colored.webm"
            pipeline._encode_webm(frames, masks, output, 1.0, runtime)
            decoded = subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-c:v",
                    "vp9",
                    "-i",
                    str(output),
                    "-frames:v",
                    "1",
                    "-pix_fmt",
                    "rgb24",
                    "-f",
                    "rawvideo",
                    "-",
                ],
                check=True,
                stdout=subprocess.PIPE,
            ).stdout
            pixels = [decoded[index : index + 3] for index in range(0, len(decoded), 3)]
            mean_chroma = sum(max(pixel) - min(pixel) for pixel in pixels) / len(pixels)
            exact_gray_ratio = sum(pixel[0] == pixel[1] == pixel[2] for pixel in pixels) / len(pixels)
            self.assertGreater(mean_chroma, 20)
            self.assertLess(exact_gray_ratio, 0.05)

    def test_resolution_is_even_bounded_and_preserves_aspect_when_one_axis_is_automatic(self):
        pipeline = load_pipeline()
        self.assertEqual(pipeline.normalize_resolution(1008, 720, 720, 0), (720, 514))
        self.assertEqual(pipeline.normalize_resolution(1008, 720, 0, 720), (1008, 720))
        self.assertEqual(pipeline.normalize_resolution(1008, 720, 5001, 5001), (4096, 4096))

    def test_matting_parameter_defaults_match_the_existing_pipeline(self):
        pipeline = load_pipeline()
        parameters = pipeline.MattingParameters.from_mapping({})
        self.assertEqual(parameters.background_cutoff, 0.0)
        self.assertEqual(parameters.seed_threshold, 0.5)
        self.assertEqual(parameters.core_threshold, 0.35)
        self.assertEqual(parameters.support_radius, 30)
        self.assertEqual(parameters.feather_sigma, 5.0)

        javascript = (ROOT / "video_editor_module" / "static" / "app.js").read_text(
            encoding="utf-8"
        )
        match = re.search(
            r"DEFAULT_MATTING_PARAMETERS = Object\.freeze\(\{(?P<body>.*?)\}\);",
            javascript,
            re.DOTALL,
        )
        self.assertIsNotNone(match)
        ui_defaults = {
            key: float(value)
            for key, value in re.findall(r"(\w+):\s*([0-9.]+)", match.group("body"))
        }
        self.assertEqual(ui_defaults, {
            "backgroundCutoff": parameters.background_cutoff,
            "seedThreshold": parameters.seed_threshold,
            "coreThreshold": parameters.core_threshold,
            "supportRadius": float(parameters.support_radius),
            "featherSigma": parameters.feather_sigma,
        })

        custom = pipeline.MattingParameters.from_mapping({
            "backgroundCutoff": 0.08,
            "seedThreshold": 0.6,
            "coreThreshold": 0.45,
            "supportRadius": 18,
            "featherSigma": 3.5,
        })
        self.assertEqual(custom.background_cutoff, 0.08)
        self.assertEqual(custom.seed_threshold, 0.6)
        self.assertEqual(custom.core_threshold, 0.45)
        self.assertEqual(custom.support_radius, 18)
        self.assertEqual(custom.feather_sigma, 3.5)

        with self.assertRaisesRegex(ValueError, "backgroundCutoff"):
            pipeline.MattingParameters.from_mapping({"backgroundCutoff": 0.75})
        with self.assertRaisesRegex(ValueError, "supportRadius"):
            pipeline.MattingParameters.from_mapping({"supportRadius": 101})
        with self.assertRaisesRegex(ValueError, "必须是对象"):
            pipeline.MattingParameters.from_mapping([])

    def test_manual_subject_point_maps_to_the_selected_video_frame(self):
        pipeline = load_pipeline()
        pipeline_source = (ROOT / "video_editor_module" / "pipeline.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('fps={frame_rate:.8f}', pipeline_source)
        self.assertEqual(pipeline.SubjectSelection.from_mapping(None).mode, "auto")
        selection = pipeline.SubjectSelection.from_mapping({
            "mode": "point",
            "x": 0.25,
            "y": 0.75,
            "timeSeconds": 2.0,
        })
        seed = pipeline.resolve_point_seed(
            selection,
            start_seconds=1.0,
            end_seconds=4.0,
            frame_rate=30.0,
            frame_count=100,
            width=1008,
            height=720,
        )
        self.assertEqual(seed[0], 30)
        self.assertAlmostEqual(seed[1][0], 251.75)
        self.assertAlmostEqual(seed[1][1], 539.25)

        with self.assertRaisesRegex(ValueError, "点选主体"):
            pipeline.SubjectSelection.from_mapping({"mode": "point", "x": 1.2, "y": 0.5})
        with self.assertRaisesRegex(ValueError, "时间范围"):
            pipeline.resolve_point_seed(
                selection,
                start_seconds=2.5,
                end_seconds=4.0,
                frame_rate=30.0,
                frame_count=100,
                width=1008,
                height=720,
            )

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
