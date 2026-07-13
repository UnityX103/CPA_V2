# Video editor runtime staging area

The large video-matting payload is not stored in Git. A release build stages
exactly one thin target directory next to this file:

- `macos-x86_64/`
- `macos-arm64/`
- `windows-x86_64/`

Each target contains FFmpeg, ffprobe, a relocatable BackgroundRemover worker
with its own Python/PyTorch runtime, the pinned U2NetP model, licenses, and a
`runtime-manifest.json`. Tauri bundles the whole `video-runtime/` directory, so
preparation removes every other target before packaging.

The frozen BackgroundRemover worker runs with `NUMBA_DISABLE_JIT=1` and an
external temporary `NUMBA_CACHE_DIR`. PyInstaller does not provide the source
locator required by pymatting's `cache=True` decorators, so changing only the
cache directory is insufficient. The same environment is used for build
smoke checks, runtime health probes, and actual processing.

From `app/`:

```bash
npm run video-runtime:lock -- --target <runtime-target> ...
npm run video-runtime:prepare -- --target <runtime-target> --lock <lock-file> ...
npm run video-runtime:verify -- --target <runtime-target> --smoke
npm run build:self-contained -- --target <tauri-target> --bundles app,dmg
```

Both `tauri build` and `tauri bundle` are gated by target-specific verification.
The self-contained wrapper also clears the old bundle output and verifies the
exact generated macOS `.app` after packaging.

The verifier rejects:

- the wrong native architecture, Universal Mach-O files, and mixed native trees;
- symlinks, undeclared files, changed hashes, or a mismatched manifest;
- a missing, changed, or unrecorded CPA_V2 patch to the pinned
  BackgroundRemover source;
- FFmpeg builds containing `--enable-nonfree`;
- missing required encoders or a BackgroundRemover worker that cannot start;
- macOS dependencies/RPATHs that escape the payload or point at Homebrew,
  `/usr/local`, or another build-machine path;
- incomplete license packs for FFmpeg, Python, PyTorch/TorchVision,
  PyInstaller, BackgroundRemover, and U2NetP.

`source-policy.json` pins the BackgroundRemover commit, the repository patch
that adds the CPU device override, and the U2NetP hash. The lock and manifest
must repeat the exact patch id/path/hash set.
`release-lock.example.json` uses `macos-arm64` to document the immutable
provenance fields expected for every real target lock; each target must replace
the example sources and hashes with its own artifacts. A copied virtualenv
entry script is never accepted as a self-contained worker.

macOS packages support separate thin x86_64 and arm64 payloads. The
`x86_64-apple-darwin` package contains only `macos-x86_64`; the
`aarch64-apple-darwin` package contains only `macos-arm64`. An Apple Silicon
host can smoke-test arm64 natively and x86_64 through Rosetta, while an Intel
Mac cannot execute the arm64 smoke test. Universal or mixed-architecture
payloads remain invalid. Both current workers contain native libraries built
for macOS 14.0, so the shared Tauri bundle minimum is also 14.0. Package
verification reads every Mach-O deployment target from `otool -l`, takes the
greatest value, and rejects a lower Tauri declaration.

Windows remains x86_64-only and uses the same layout and architecture
contract. Final NSIS resource inspection and real-media inference must run on
a matching Windows x64 build host.
