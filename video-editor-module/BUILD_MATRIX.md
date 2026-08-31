# Video editor module build matrix

All release archives are native, thin, self-contained runtimes. A target is not
added to the signed public index until its row passes the golden-video smoke test.

| Target | Native build | Golden MP4 → alpha WebM | Host install/launch | Release status |
|---|---:|---:|---:|---|
| macOS ARM64 | implemented | passed locally | host contract passed | blocked by BiRefNet provenance |
| macOS x86_64 | script ready | pending x86 machine/runner | contract only | blocked |
| Windows x86_64 | script ready | pending x64 machine/runner | contract only | blocked |

Build each row on its matching architecture:

```bash
python video-editor-module/scripts/build_runtime.py \
  --target macos-arm64 \
  --ffmpeg-dir /absolute/audited-ffmpeg/bin \
  --output /absolute/build/runtime
```

Then package with `package_module.py`. A public package requires commercially
cleared weights, Developer ID signing on macOS or valid Authenticode on Windows,
and an LGPL-compatible FFmpeg. Assemble all three `.package.json` files using
`build_index.py`, sign the resulting index, and publish the index, its `.sig`,
and all archives in the same GitHub Release.

The Tauri signer writes a Base64-wrapped Minisign document. Do not decode or
rewrite the `.sig` before publishing; the host validates that exact format.
