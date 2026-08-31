# CPA Video Editor Module

This directory is the independently maintained, downloadable video editor. It
is intentionally outside `app/` and is not referenced by Tauri `resources` or
the Vite entry graph. The default CPA_V2 package contains only the installer
and launcher contract.

The module implements the selected fourth pipeline:

1. BiRefNet-matting generates animal-friendly soft alpha for every frame.
2. SAM 2.1 Hiera Base+ propagates one automatically selected subject mask in
   both directions.
3. A broad support-band fusion keeps the SAM object identity while preserving
   BiRefNet fur and motion blur.
4. A bundled, license-reviewed FFmpeg/libvpx build exports VP8 Alpha WebM.

The downloaded UI retains video preview, current-frame screenshot, trim time,
output-resolution controls, transparent-result preview, and export. It has no
crop-box drawing, eraser brush, or other region drawing tool.

## Package contract

Each platform archive has this shape:

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

`module.json` declares `sam2-birefnet-v1`, `screenshot`,
`output-resolution`, and `vp8-alpha-webm`. The host rejects archives without
all four capabilities, path traversal, symlinks, target mismatches, size
overflow, or SHA-256 mismatch.

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

Use `scripts/package_module.py` to assemble a prepared frozen runtime into the
archive consumed by CPA_V2's settings-panel downloader.

For the public learning release pass
`--distribution noncommercial-open-source --licenses licenses`. Commercial
mode remains fail-closed.

`scripts/build_runtime.py` builds that runtime natively for exactly one target,
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

## Published learning module

`1.0.0-noncommercial.1` is published on CPA_V2 `v0.1.21` for macOS ARM64,
macOS x86_64, and Windows x86_64. The signed index is
`video-editor-module-index.json`. This release is explicitly non-commercial;
see `licenses/NONCOMMERCIAL-NOTICE.md` and
`RELEASE_MANIFEST_1.0.0-noncommercial.1.json`.
