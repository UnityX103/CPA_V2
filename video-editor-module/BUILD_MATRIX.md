# Video editor module build matrix

Engine archives are native and thin; model weights and business/UI are common
components. A target is not added to the signed public index until its engine
row passes the golden-video smoke test.

| Target | Native build | Golden MP4 → alpha WebM | Host install/launch | Release status |
|---|---:|---:|---:|---|
| macOS ARM64 | native thin runtime | passed, 30 frames | server + package passed | published, non-commercial |
| macOS x86_64 | Rosetta x86_64 runtime | passed, 6 frames | server + package passed | published, non-commercial |
| Windows x86_64 | native PE32+ x64 runtime | passed, 6 frames | server + package passed | published, non-commercial |

Build each row on its matching architecture:

```bash
python video-editor-module/scripts/build_runtime.py \
  --layout layered \
  --target macos-arm64 \
  --ffmpeg-dir /absolute/audited-ffmpeg/bin \
  --output /absolute/build/runtime \
  --licenses-output /absolute/build/licenses
```

For Windows, additionally pass `--windows-crt-dir` with the x64 Visual Studio
CRT redistributable directory (`VC/Redist/MSVC/<version>/x64/Microsoft.VC143.CRT`).
The build and both packagers reject any bundled EXE, DLL or PYD whose on-disk PE
machine is not AMD64 (`0x8664`), including ARM64X and ARM64EC files that can load
successfully under Windows-on-ARM emulation.

The Windows row above records historical acceptance on an ARM64 Parallels VM.
On 2026-09-05, inspection of the published Windows engine found ARM64/ARM64X
`msvcp140.dll` and `vcruntime140.dll` collected from `HostARM64/x64`. Therefore
that historical smoke pass does **not** establish Intel/AMD compatibility.
After rebuilding with the x64 redistributables, repeat the frozen NumPy,
PyTorch/NumPy bridge and golden-video checks on Intel/AMD Windows 11 as well as
the VM. Keep the shared models and other platforms' engines unchanged when
publishing this Windows engine repair under a new component version/hash.

Then package changed components with `package_layers.py` and assemble them with
`build_layered_index.py`. Commercial public packages require
commercially cleared weights, Developer ID signing on macOS, valid Authenticode
on Windows, and an LGPL-compatible FFmpeg. Non-commercial public packages must
preserve the non-commercial notices and complete source/license manifest. Their
macOS executables require valid code signatures (ad-hoc is accepted); Windows
executables may be unsigned, in which case the package records
`unsigned-index-authenticated` and Windows can show SmartScreen. Every public
package is authenticated by its SHA-256 in the Tauri Minisign-signed index.

The layered engine packager refuses `releaseEligible=true` unless the license pack has
the Python, FFmpeg, and libvpx notices, exact FFmpeg configuration, package
license inventory, and a target-matching source manifest. The models packager
requires pinned SAM2/BiRefNet provenance, while the logic packager requires the
non-commercial notice and third-party source inventory. Assemble all three
`.component.json` metadata. Reuse unchanged engine/model documents from their
original tagged releases, build a new lightweight logic document, sign the
resulting schema-v2 index, and publish only changed component archives. The
legacy `package_module.py`/`build_index.py` path remains for v1 reproduction.

The Tauri signer writes a Base64-wrapped Minisign document. Do not decode or
rewrite the `.sig` before publishing; the host validates that exact format.

Published module: `1.3.0-noncommercial.1` on CPA_V2 release `v0.1.26` using
schema-v2 layered artifacts. The first layered release publishes shared models,
three native engines, and the lightweight business/UI logic separately.
All three packages use the same SAM2 and BiRefNet hashes. macOS ARM64 uses MPS
for BiRefNet and CPU for SAM2; macOS x86_64 and Windows x86_64 use CPU fallback.
The default matting parameters preserve the 1.0.0 output behavior; users can
optionally select a subject point and tune the five exposed thresholds.
Version 1.3.0 uses VP9 alpha at CRF 18, preserves visible RGB color through
`maskedmerge`, clears hidden RGB below the alpha visibility floor, and opens a
native save dialog for both downloadable outputs.
