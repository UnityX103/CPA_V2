# Downloadable AI video editor module

Date: 2026-08-31

## Goal

Restore the removed video-editor surface as an optional module without putting
its UI, Python/PyTorch runtime, SAM2/BiRefNet weights, or media binaries in the
default CPA_V2 package.

The settings app contains only a small host shell: status, download progress,
open, and remove. The complete editor is downloaded per target and runs as a
localhost-only process with a random session token; Tauri opens that process's
UI in a separate window.

## Historical baseline

The visual hierarchy follows the editor immediately before commit `0bf3217`:
import/runtime card, source preview, editing controls, processing progress,
transparent-result preview, and export. The old implementation's crop drag and
erase brush are deliberately not restored.

The downloadable UI keeps:

- video import and preview;
- current-frame PNG screenshot;
- start/end time;
- original/720/1080/custom output resolution;
- processing progress;
- checkerboard transparent preview and VP8 Alpha WebM export.

It does not register pointer drawing handlers or expose crop-box, brush,
freehand mask, or static erase-region data.

## Package boundary

Default app:

- `video_editor_module.rs`: HTTPS download, SHA-256, ZIP safety checks,
  install pointer, localhost process lifecycle, and external WebView window;
- settings `VideoEditorModuleTab`: placeholder/download/open/delete UI;
- no model code, model weights, FFmpeg, Python, or full editor assets.

Downloaded module:

- full static editor UI;
- frozen Python runtime and pipeline;
- SAM 2.1 Hiera Base+ and BiRefNet-matting checkpoint;
- audited FFmpeg/FFprobe/libvpx;
- all third-party licenses, source policy, and runtime manifest.

Archives are target-specific. The raw index has a detached Minisign signature
made with the Tauri updater key. The host verifies it before parsing, then validates module id, schema, version,
target, required capabilities, exact archive size/hash, safe paths, symlink
absence, extracted-size limits, and the declared entry executable.

## Pipeline

1. Decode the selected time range at the chosen fixed output resolution.
2. Run BiRefNet-matting for every frame.
3. Select the clearest subject frame from alpha coverage.
4. Seed SAM 2.1 from that alpha mask and propagate forward/backward.
5. Fuse BiRefNet alpha inside a broad SAM support band; no user-drawn regions.
6. Encode VP8 Alpha WebM with `ALPHA_MODE=1`.

SAM2 is forced to CPU on macOS until a validated accelerator replaces the MPS
path that produced noise on the golden clip. Windows uses CUDA when available,
otherwise CPU.

On macOS the installed module's audited FFmpeg is also the preferred converter
for the main app's HEVC-alpha playback cache. This keeps the exported WebM
usable on a clean machine without requiring a Homebrew FFmpeg installation.
The module generates a temporary HEVC-alpha MOV for its own macOS result
preview while keeping WebM as the downloadable/current-software artifact.

## Release gate

The host points at GitHub Release assets, but no commercial module should be
published until the BiRefNet-matting checkpoint's PPM-100 provenance is cleared
or replaced. `video-editor-module/source-policy.json` records this as a
fail-closed package-build gate. The module packager also rejects FFmpeg builds
containing `--enable-gpl` or `--enable-nonfree`.
