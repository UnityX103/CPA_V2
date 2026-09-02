# CPA Video Editor Module

This directory is the independently maintained, downloadable video editor. It
is intentionally outside `app/` and is not referenced by Tauri `resources` or
the Vite entry graph. The default CPA_V2 package contains only the installer
and launcher contract.

The module implements the selected fourth pipeline:

1. BiRefNet-matting generates animal-friendly soft alpha for every frame.
2. SAM 2.1 Hiera Base+ propagates either an automatically selected mask or a
   user-selected positive point in both directions.
3. A broad support-band fusion keeps the SAM object identity while preserving
   BiRefNet fur and motion blur.
4. A bundled, license-reviewed FFmpeg/libvpx build exports high-quality VP9 Alpha WebM.

The downloaded UI retains video preview, current-frame screenshot, trim time,
output-resolution controls, transparent-result preview, and export. Automatic
subject selection remains the default; users may opt into point selection and
adjust the background cutoff, seed/core thresholds, support radius, and feather
sigma. The defaults preserve the original pipeline exactly. It has no crop-box
drawing, eraser brush, or other region drawing tool.

## Package contract

New releases use a schema-v2 layered contract so UI and business changes do
not re-upload models or native runtimes:

```text
video-editor-logic-<version>.zip
  module.json
  video_editor_module/{Python,static UI}
  licenses/...

video-editor-models-<version>.zip
  models.json
  models/{sam2,birefnet}/...
  licenses/...

video-editor-engine-<version>-<target>.zip
  engine.json
  runtime/video-editor-host[.exe]
  runtime/_internal/...
  runtime/bin/{ffmpeg,ffprobe}[.exe]
  licenses/...
```

`video-editor-module-index.json` independently selects one common logic
component, one common model component, and one engine for each of macOS ARM64,
macOS x86_64, and Windows x86_64. An update downloads only components whose
version is not already installed, validates `engineAbi` and `modelSet`, rechecks
the signed package SHA marker plus every declared file size/SHA-256, and then
atomically switches the active pointer after all three pass. Component URLs may
refer to older release tags, which is how unchanged multi-gigabyte assets are
reused across releases.

The host remains compatible with the legacy schema-v1 platform archive:

```text
module.json
runtime/
  video-editor-module[.exe]
  _internal/...
  bin/{ffmpeg,ffprobe}[.exe]
  models/{sam2,birefnet}/...
licenses/...
runtime-manifest.json
```

`module-contract.json` is the source of truth shared by the packagers and host.
The generated `module.json` declares `sam2-birefnet-v1`, `screenshot`,
`output-resolution`, `vp9-alpha-webm`, `masked-transparent-rgb-v1`, `subject-point-selection`, and
`matting-parameters-v1`. The host rejects archives without all required
capabilities, path traversal, symlinks, target mismatches, size overflow, or
SHA-256 mismatch.

## Commercial release gate

`source-policy.json` records a blocking provenance issue: the upstream
BiRefNet-matting model card is MIT, but lists PPM-100 as training data and the
PPM-100 alpha annotations are CC BY-NC-SA 4.0. This project publishes the
downloadable module only for non-commercial open-source learning and research,
with attribution and modification notices in `licenses/`. A commercial package
must replace the checkpoint with a commercially cleared weight or archive
written authorization from the upstream author.

Do not bundle the developer machine's Homebrew FFmpeg. It is a GPL build. Use
an audited minimal LGPL-compatible build with libvpx, or a native media path.

## Development

The server can be launched from an environment that already contains the
locked dependencies and prepared runtime:

```bash
CPA_VIDEO_EDITOR_RUNTIME_ROOT=/absolute/runtime \
python -m video_editor_module --serve --host 127.0.0.1 --port 8765 --token dev-token
```

Run contract tests without model dependencies:

```bash
python -m unittest discover -s video-editor-module/tests
```

Use `scripts/package_layers.py` for new releases. It creates independent
`engine`, `models`, and `logic` archives plus `.component.json` metadata.
`scripts/build_layered_index.py` combines one logic document, one models
document, and all three engine documents into the signed schema-v2 index.
`scripts/package_module.py` and `scripts/build_index.py` remain available only
for legacy schema-v1 compatibility.

For the public learning release pass
`--distribution noncommercial-open-source --licenses licenses`. Commercial
mode remains fail-closed.

`scripts/build_runtime.py --layout layered` builds an engine natively for
exactly one target without weights or UI. `scripts/prepare_models.py` prepares
the shared audited weight tree once. The default `legacy` layout remains for
reproducing older releases. The runtime builder
pins SAM2 to the audited Git commit, verifies both model hashes, and copies an
explicitly supplied FFmpeg/FFprobe pair. See `BUILD_MATRIX.md` for the release
acceptance matrix. `scripts/build_index.py` refuses to produce a public index
unless all three required target package documents are present and each is
marked `releaseEligible: true`. `--allow-internal` produces a `debugOnly` index
that release builds of the host reject.

The published `video-editor-module-index.json` must be signed with the same
Minisign key as the Tauri updater. Place the detached signature beside it as
`video-editor-module-index.json.sig`; for example:

```bash
cd app
npm run tauri -- signer sign ../release/video-editor-module-index.json
```

The host verifies that signature with the updater public key before trusting
any archive URL or SHA-256. On macOS, the module's FFmpeg must additionally
include `hevc_videotoolbox`; the main app reuses it when converting the exported
WebM into the HEVC-alpha playback cache.
The Tauri signer writes a Base64-wrapped Minisign document; publish the `.sig`
exactly as generated rather than decoding or rewriting it.

The logic layer requires the non-commercial notice and third-party source
inventory. The shared models layer additionally requires a generated
`SOURCE-MANIFEST.json` whose pinned SAM2 and BiRefNet provenance matches
`source-policy.json`. Engine packages retain the full platform-specific Python,
FFmpeg, libvpx, and source-manifest gate.

## Published learning module

`1.3.0-noncommercial.1` is published on CPA_V2 `v0.1.26` as the first schema-v2
layered release. Shared model weights, native engines, and lightweight business/UI
logic are versioned independently. Version 1.3.0 fixes the frozen v1.2.0 encoder's
grayscale `maskedmerge` negotiation by requiring an RGB mask, and routes both
download actions through the Tauri save dialog instead of navigating the preview.

`1.2.0-noncommercial.1` is published on CPA_V2 `v0.1.24` for macOS ARM64,
macOS x86_64, and Windows x86_64. The signed index is
`video-editor-module-index.json`. This release is explicitly non-commercial;
see `licenses/NONCOMMERCIAL-NOTICE.md` and
`RELEASE_MANIFEST_1.2.0-noncommercial.1.json`. Version 1.2.0 exports higher-quality
VP9 alpha video, masks hidden background RGB for alpha-ignorant players, and
reports the exact backend-applied defaults in the UI.

Mainland China mirror: `https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/tag/v0.1.26`.
The CNB-signed module index uses CNB component URLs first and keeps matching
GitHub Release assets as authenticated fallback mirrors. Reused components keep
their original release tag on both providers.
