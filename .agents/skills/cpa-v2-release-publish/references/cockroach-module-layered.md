# Layered cockroach module release

Schema v2 has three independently reusable layers:

- `cockroach-runtime-<electron-version>-<target>.zip` contains only the official Electron runtime,
  bundled Electron/Chromium notices, CPA's non-commercial distribution notice, and `runtime.json`.
- `cockroach-dependencies-<dependency-version>.zip` contains the pinned production JavaScript
  dependency tree, generated package/license inventory, upstream notices, and `dependencies.json`.
- `cockroach-logic-<logic-version>.zip` contains only the pinned and reviewed CockroachPet source,
  upstream notices, and `module.json`.

The active index version equals the logic version. Runtime ZIPs are immutable and content-addressed;
reuse an older runtime or dependency document only when its signed-index SHA-256,
`manifestSha256`, ABI/set identifier, target where applicable, and version match. Never copy an
unchanged runtime/dependency ZIP into a new Release.

All public components must declare `distribution: noncommercial-open-source`. This is CPA_V2's
distribution policy, not a replacement for CockroachPet's MIT license or Electron's upstream terms.

## Build

Prepare the exact pinned checkout and production dependencies as documented in
`cockroach-electron-module/README.md`, then run `package_layers.py dependencies` and
`package_layers.py logic` once and
`package_layers.py runtime` for macOS ARM64, macOS x86_64, and Windows x86_64. Build the index from
the five `.component.json` documents with `build_layered_index.py`.

The macOS packager preserves only relative, non-escaping framework symlinks, re-signs the copied
thin Electron app ad hoc, and verifies its architecture and resource seal. The Windows packager
requires a PE32+ x86-64 Electron executable. Runtime documents are not release-eligible by default.
Smoke-test the exact runtime ZIP together with the dependency and logic ZIPs, write the target
receipt, then run `accept_runtime.py`; `build_layered_index.py` rejects a runtime without a matching
archive-hash receipt. Test macOS ARM64 and x86_64 on matching execution environments and Windows in
the Parallels VM.

## Publish and cache rules

Upload changed component ZIPs and their `.component.json` documents before
`cockroach-module-index.json.sig` and `cockroach-module-index.json`. Generate a CNB-specific index by
rewriting every component URL to its original CNB release tag and retaining GitHub in `mirrors`, then
sign the rewritten bytes separately. Never upload one provider's signed index to the other.

Public gates must verify both signatures and follow `logic`, `dependencies`, and every `runtimes.*` URL, including
Range requests, declared byte sizes, archive SHA-256 values, manifest hashes, non-commercial notices,
and platform architecture/signature checks. A missing reused component on either provider blocks the
release.
