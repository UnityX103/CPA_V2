# Cockroach Electron module

CPA does not bundle or download the cockroach runtime by default. This directory defines the
optional-module package consumed by `app/src-tauri/src/cockroach_module.rs`.

The runtime source is pinned to
[`jo9900/CockroachPet-Public-Electron`](https://github.com/jo9900/CockroachPet-Public-Electron)
commit `a7d103d2818b40e12b8a39948e9ebf4c6085bfd3` (upstream version `1.1.0`). The package uses the
upstream Electron application and vector renderer directly. CPA only owns download verification,
settings seeding, and child-process lifecycle.

## Build a runtime

```bash
git clone https://github.com/jo9900/CockroachPet-Public-Electron.git
cd CockroachPet-Public-Electron
git checkout a7d103d2818b40e12b8a39948e9ebf4c6085bfd3
npm install
```

Build an unpacked, self-contained Electron directory for the target platform. Do not package an
installer; the CPA module launcher executes the packaged app binary directly.

Examples:

```bash
# macOS ARM64
npx electron-builder --mac --arm64 --dir
python ../CPA_V2/cockroach-electron-module/scripts/package_module.py \
  --runtime-dir dist/mac-arm64/CockroachPet.app \
  --entry 'runtime/CockroachPet.app/Contents/MacOS/CockroachPet' \
  --target macos-arm64 --version 1.1.0 \
  --output-dir ../CPA_V2/cockroach-electron-module/dist

# Windows x86_64 (run on Windows)
npx electron-builder --win --x64 --dir
python ..\CPA_V2\cockroach-electron-module\scripts\package_module.py \
  --runtime-dir dist\win-unpacked \
  --entry 'runtime/win-unpacked/CockroachPet.exe' \
  --target windows-x86_64 --version 1.1.0 \
  --output-dir ..\CPA_V2\cockroach-electron-module\dist
```

For macOS x86_64, build with `--x64 --dir` and use target `macos-x86_64`.

The generated ZIP contains `module.json`, the unpacked runtime, and the upstream MIT license.
Publish the target ZIPs to a `UnityX103/CPA_V2` GitHub Release, create
`cockroach-module-index.json` with each ZIP's HTTPS URL, exact byte size and SHA-256, then sign that
index with the same minisign key used by the Tauri updater. Publish the Base64-wrapped signature as
`cockroach-module-index.json.sig`.

The default index URL intentionally returns a friendly “尚未开放下载” error until verified macOS
ARM64, macOS x86_64 and Windows x86_64 packages are published.

## Upstream settings and lifecycle

CPA writes Electron Store's `config.json` under the module-specific `--user-data-dir` before launch:

- `settings.maxCount`: 1–99, default 30;
- `settings.babyGrowthMinutes`: 1–60, default 10;
- `cockroaches`: reset to an empty list for each simulation.

“模拟” starts the upstream executable. “杀死所有” sends the upstream `Cmd/Ctrl+K` global shortcut,
so the live Electron process runs its own `manager.killAll()` behavior. Leaving the break phase,
uninstalling the module, and exiting CPA terminate the tracked child process and clear persisted
cockroaches. Saving settings while the module is active restarts that process once so the new values
take effect immediately without desynchronizing the Pomodoro controller.
