# Video editor module build matrix

All release archives are native, thin, self-contained runtimes. A target is not
added to the signed public index until its row passes the golden-video smoke test.

| Target | Native build | Golden MP4 → alpha WebM | Host install/launch | Release status |
|---|---:|---:|---:|---|
| macOS ARM64 | native thin runtime | passed, 30 frames | server + package passed | published, non-commercial |
| macOS x86_64 | Rosetta x86_64 runtime | passed, 6 frames | server + package passed | published, non-commercial |
| Windows x86_64 | native PE32+ x64 runtime | passed, 6 frames | server + package passed | published, non-commercial |

Build each row on its matching architecture:

```bash
python video-editor-module/scripts/build_runtime.py \
  --target macos-arm64 \
  --ffmpeg-dir /absolute/audited-ffmpeg/bin \
  --output /absolute/build/runtime
```

Then package with `package_module.py`. Commercial public packages require
commercially cleared weights, Developer ID signing on macOS, valid Authenticode
on Windows, and an LGPL-compatible FFmpeg. Non-commercial public packages must
preserve the non-commercial notices and complete source/license manifest. Their
macOS executables require valid code signatures (ad-hoc is accepted); Windows
executables may be unsigned, in which case the package records
`unsigned-index-authenticated` and Windows can show SmartScreen. Every public
package is authenticated by its SHA-256 in the Tauri Minisign-signed index.

`package_module.py` refuses `releaseEligible=true` unless the license pack has
the Python, FFmpeg, and libvpx notices, exact FFmpeg configuration, package
license inventory, and a target-matching source manifest. Assemble all three
`.package.json` files using `build_index.py`, sign the resulting index, and
publish the index, its `.sig`, source archives, and all runtime archives in the
same GitHub Release.

The Tauri signer writes a Base64-wrapped Minisign document. Do not decode or
rewrite the `.sig` before publishing; the host validates that exact format.

Published module: `1.2.0-noncommercial.1` on CPA_V2 release `v0.1.24`.
All three packages use the same SAM2 and BiRefNet hashes. macOS ARM64 uses MPS
for BiRefNet and CPU for SAM2; macOS x86_64 and Windows x86_64 use CPU fallback.
The default matting parameters preserve the 1.0.0 output behavior; users can
optionally select a subject point and tune the five exposed thresholds.
Version 1.2.0 uses VP9 alpha at CRF 18 and clears hidden RGB below the alpha
visibility floor so players without alpha support no longer reveal the source background.
