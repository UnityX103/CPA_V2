# Layered video editor module release

Schema v2 separates artifacts by change frequency:

- `video-editor-models-<model-version>.zip`: shared SAM2/BiRefNet weights. Rebuild only when a weight, model license/provenance record, or `modelSet` changes.
- `video-editor-engine-<engine-version>-<target>.zip`: one native Python/PyTorch/FFmpeg host per supported target. Rebuild only when native dependencies, FFmpeg, the bootstrap host, lock files, or `engineAbi` changes.
- `video-editor-logic-<logic-version>.zip`: Python business code and downloadable UI. Build for every video-editor behavior/UI update; it must not contain `runtime/` or `models/`.

The active index version equals the logic version. It may reference engine and model assets from older release tags. Reuse an older component only when its signed-index SHA-256, component manifest version, `engineAbi`, and `modelSet` match the new logic manifest. The client persists the package hash and rechecks every manifest file hash before skipping a download.

## Build and package changed components

Build engines natively with `--layout layered`. Prepare shared weights once:

```bash
python3 video-editor-module/scripts/build_runtime.py \
  --layout layered --target <target> \
  --ffmpeg-dir /absolute/audited-ffmpeg/bin \
  --output /absolute/build/engine \
  --licenses-output /absolute/build/licenses \
  --work-dir /absolute/build/engine-work

python3 video-editor-module/scripts/prepare_models.py \
  --output /absolute/build/models --cache-dir /absolute/model-cache \
  --python /absolute/build/engine-work/venv/bin/python
```

On Windows, pass `engine-work\venv\Scripts\python.exe`. Model preparation needs the engine build environment because it contains the pinned `huggingface_hub` dependency.

Windows engine builds also require `--windows-crt-dir` pointing to
`VC/Redist/MSVC/<version>/x64/Microsoft.VC143.CRT`. Never use the compiler's
`HostARM64/x64` directory: its CRT files can be ARM64/ARM64X even though the
compiler targets x64. The builder replaces collected CRT files from the
explicit x64 redistributable set, and both packagers inspect every bundled
EXE/DLL/PYD for AMD64 (`0x8664`). A smoke pass on an ARM Windows VM alone is not
evidence that an engine will run on Intel/AMD Windows; verify that platform too.

Package only components whose version changed:

```bash
python3 video-editor-module/scripts/package_layers.py engine \
  --target <target> --version <engine-version> \
  --runtime /absolute/build/engine --licenses /absolute/build/licenses \
  --output-dir /absolute/release-stage/video \
  --release-url https://github.com/UnityX103/CPA_V2/releases/download/v<app-version> \
  --distribution noncommercial-open-source

python3 video-editor-module/scripts/package_layers.py models \
  --version <model-version> --models /absolute/build/models \
  --licenses /absolute/build/licenses \
  --output-dir /absolute/release-stage/video \
  --release-url https://github.com/UnityX103/CPA_V2/releases/download/v<app-version> \
  --distribution noncommercial-open-source

python3 video-editor-module/scripts/package_layers.py logic \
  --version <logic-version> \
  --source video-editor-module/video_editor_module \
  --licenses video-editor-module/licenses \
  --output-dir /absolute/release-stage/video \
  --release-url https://github.com/UnityX103/CPA_V2/releases/download/v<app-version> \
  --distribution noncommercial-open-source
```

## Build and sign the index

Build schema v2 from one logic document, one models document, and three engine documents. Documents for unchanged components retain their original tagged URLs:

```bash
python3 video-editor-module/scripts/build_layered_index.py \
  --version <logic-version> \
  --output /absolute/release-stage/video-editor-module-index.json \
  /absolute/components/video-editor-logic-<logic-version>.component.json \
  /absolute/components/video-editor-models-<model-version>.component.json \
  /absolute/components/video-editor-engine-<engine-version>-macos-arm64.component.json \
  /absolute/components/video-editor-engine-<engine-version>-macos-x86_64.component.json \
  /absolute/components/video-editor-engine-<engine-version>-windows-x86_64.component.json
```

Upload each newly built component ZIP and its tiny `.component.json` document before the GitHub index, then sign the GitHub index. Retain those documents as reusable release metadata. CNB preparation rewrites every component to the corresponding CNB release tag—including reused older tags—and preserves GitHub as a mirror. Sign the rewritten CNB index separately. Do not upload unchanged engine/model ZIPs again.

Public gates must follow every `logic`, `models`, and `engines.*` URL in each signed index. Verify HTTP Range download, declared size, and SHA-256. A referenced older component must already exist on both providers under its original tag; otherwise stop publication instead of silently copying it to the current release.
