# Cockroach Electron module

CPA does not bundle or download the cockroach runtime by default. This directory defines the
optional-module package consumed by `app/src-tauri/src/cockroach_module.rs`.

The runtime source is pinned to
[`jo9900/CockroachPet-Public-Electron`](https://github.com/jo9900/CockroachPet-Public-Electron)
commit `a7d103d2818b40e12b8a39948e9ebf4c6085bfd3` (upstream version `1.1.0`). The package uses the
upstream Electron application and vector renderer directly. CPA only owns download verification,
settings seeding, and child-process lifecycle.

New public packages use index schema v2 and are split by change frequency:

- `cockroach-runtime-40.8.0-<target>.zip`: the Electron base runtime for one target;
- `cockroach-dependencies-<version>.zip`: the shared production JavaScript dependency tree and
  generated SPDX-style package/license inventory;
- `cockroach-logic-<version>.zip`: only the small platform-independent CockroachPet business code.

All three components are content-addressed. Runtime and dependencies remain installed when only the
business package changes. The
client verifies the component manifest and every listed file before it skips a download. All CPA
component documents use the `noncommercial-open-source` distribution policy while preserving the
upstream MIT and dependency licenses.

The CPA extension manager exposes these layers as two logical packs:

- `pet.core`: Electron runtime plus shared production dependencies and process-control protocol;
- `pet.cockroach-invasion`: CockroachPet business logic and settings, depending on `pet.core`.

Installing the feature resolves `pet.core` automatically. Uninstalling only the feature writes a
`core.json` pointer and preserves the verified runtime/dependency directories. The common pack
cannot be disabled while an enabled feature depends on it, or uninstalled while the feature remains
installed. Pomodoro events are published by the CPA core; the feature subscriber owns pet-specific
trigger policy rather than placing a pet event bridge in `pet.core`.

New logic archives declare that policy in `module.json.runtimeContribution` (event contract,
activation phase, delay, presence requirement, and settings gate). The generic extension runtime
interprets this signed declaration. Existing archives without the declaration continue through the
lazy legacy adapter until they are upgraded; new Cockroach behavior can therefore update with the
feature logic package instead of the CPA core.

## Prepare the reviewed source

```bash
git clone https://github.com/jo9900/CockroachPet-Public-Electron.git
cd CockroachPet-Public-Electron
git checkout a7d103d2818b40e12b8a39948e9ebf4c6085bfd3
npm install
python ../CPA_V2/cockroach-electron-module/scripts/prepare_source.py --source-dir .
```

## Package layered components

Package shared dependencies, then the business component. Both derive the same `dependencySet`
from the pinned production dependency inventory:

```bash
python ../CPA_V2/cockroach-electron-module/scripts/package_layers.py dependencies \
  --source-dir . --version electron-store-8.2.0-lock-1 \
  --licenses ../CPA_V2/cockroach-electron-module/licenses \
  --output-dir ../CPA_V2/cpa-v2-release/cockroach-layered \
  --release-url https://github.com/UnityX103/CPA_V2/releases/download/v<app-version>

python ../CPA_V2/cockroach-electron-module/scripts/package_layers.py logic \
  --source-dir . --version 1.2.0-noncommercial.1 \
  --licenses ../CPA_V2/cockroach-electron-module/licenses \
  --output-dir ../CPA_V2/cpa-v2-release/cockroach-layered \
  --release-url https://github.com/UnityX103/CPA_V2/releases/download/v<app-version>
```

Package official Electron `node_modules/electron/dist` directories separately. The macOS packager
preserves framework symlinks, ad-hoc signs the copied thin app, verifies the exact architecture, and
records every regular file and symlink hash. Windows must be the x86_64 Electron distribution.
Runtime component documents start with `releaseEligible: false`. After smoke-testing the exact ZIP
on its target, generate a schema-v1 receipt containing the archive hash and required passing checks,
then run `scripts/accept_runtime.py`. The index builder rejects runtimes without a matching receipt.

Examples:

```bash
# macOS ARM64 (use --target macos-x86_64 for the Intel distribution)
python ../CPA_V2/cockroach-electron-module/scripts/package_layers.py runtime \
  --runtime-dir node_modules/electron/dist \
  --entry 'runtime/Electron.app/Contents/MacOS/Electron' \
  --target macos-arm64 --version 40.8.0 \
  --licenses ../CPA_V2/cockroach-electron-module/licenses \
  --output-dir ../CPA_V2/cpa-v2-release/cockroach-layered \
  --release-url https://github.com/UnityX103/CPA_V2/releases/download/v<app-version>

# Windows x86_64
python ..\CPA_V2\cockroach-electron-module\scripts\package_layers.py runtime \
  --runtime-dir node_modules\electron\dist \
  --entry 'runtime/electron.exe' \
  --target windows-x86_64 --version 40.8.0 \
  --licenses ..\CPA_V2\cockroach-electron-module\licenses \
  --output-dir ..\CPA_V2\cpa-v2-release\cockroach-layered \
  --release-url https://github.com/UnityX103/CPA_V2/releases/download/v<app-version>
```

Build `cockroach-module-index.json` from the five generated `.component.json` documents:

```bash
python cockroach-electron-module/scripts/build_layered_index.py \
  --version 1.2.0-noncommercial.1 \
  --output /release/cockroach-module-index.json \
  /release/cockroach-logic-1.2.0-noncommercial.1.component.json \
  /release/cockroach-dependencies-electron-store-8.2.0-lock-1.component.json \
  /release/cockroach-runtime-40.8.0-macos-arm64.component.json \
  /release/cockroach-runtime-40.8.0-macos-x86_64.component.json \
  /release/cockroach-runtime-40.8.0-windows-x86_64.component.json
```

The index may reference unchanged runtime documents from older release tags. Upload only new
components, then sign each provider-specific index with the same Minisign key as the Tauri updater.
CNB is the primary source and keeps the GitHub URL as a signed mirror. Schema-v1 monolithic packages
remain readable for existing installations, but new releases use schema v2.

The default index URL intentionally returns a friendly “尚未开放下载” error until verified macOS
ARM64, macOS x86_64 and Windows x86_64 packages are published.

## Upstream settings and lifecycle

CPA writes Electron Store's `config.json` under the module-specific `--user-data-dir` before launch:

- `settings.maxCount`: 1–99, default 30;
- `settings.babyGrowthMinutes`: 1–60, default 10;
- `cockroaches`: reset to an empty list for each simulation.

“模拟” starts the upstream executable. The reviewed integration patch adds a module-private control
file; “杀死所有” sends a nonce-bearing command to the tracked Electron process, which runs its own
`manager.killAll()` behavior and writes an acknowledgement. A configured stop action, uninstalling the
module, and exiting CPA terminate the tracked child process and clear persisted cockroaches. Saving
settings while the module is active restarts that process once so the new values take effect
immediately without desynchronizing the Pomodoro controller.

## Event/action rules

The settings page now offers an ordered event/action list. Available events are focus start/end,
break start/end, and confirmed workstation presence during a running focus or break. Actions are
kill all, add one cockroach, start simulation (with one new cockroach), and stop simulation.
Rules start empty and take effect on save; they replace the former fixed break reminder policy.
See [the rule contract](../docs/superpowers/specs/2026-09-05-cockroach-event-action-rules.md).

The logic manifest declares the public event/action allow-list in `runtimeContribution.eventRules`.
The source adapter handles the new `spawn-one` control command using the existing nonce/ack protocol.
Install a newly built logic package for this command; older installed packages report an upgrade error.
The shared Electron runtime and dependencies do not need rebuilding.
