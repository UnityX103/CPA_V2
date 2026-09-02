---
name: cpa-v2-release-publish
description: Use when packaging CPA_V2, publishing synchronized Tauri updater artifacts to GitHub and CNB Releases, using an available Parallels Windows VM for Windows x64 release builds, checking macOS DMG/Gatekeeper issues, or migrating CPA_V2 release keys to another computer.
---

# CPA_V2 Release Publish

## Core Rule

Treat release signing keys, GitHub/CNB tokens, Apple credentials, and SSH private keys as local secrets. Never print, paste, commit, or upload secret contents. The authoritative release configuration lives outside the repository at:

```bash
~/.config/cpa-v2-release/release-secret-paths.env
```

Store the CNB Release OpenAPI token separately at:

```bash
~/.config/cpa-v2-release/cnb-release-token
```

Both files must be mode `600`. `release-secret-paths.env` should expose `CNB_TOKEN_FILE` and load `CNB_TOKEN` from that file. Never store the CNB token in `cpa-v2-release/` or any other project directory. GitHub SSH keys and updater keys may remain in their established user-level paths referenced by the config.

Every public macOS updater release must ship two separate thin builds: `x86_64-apple-darwin` and `aarch64-apple-darwin`. Never publish a Universal binary, and never publish `latest.json` with only one macOS architecture. By default, a public Latest release must also include Windows x86_64 NSIS and all four updater keys. Keep the release as a draft until the Windows flow is complete. Publishing macOS-only requires explicit user approval. Windows ARM64 remains out of scope unless explicitly requested.

Every release is a mandatory two-provider transaction: GitHub
`UnityX103/CPA_V2` and CNB `nanzhaigame-xpy/CPA_V2` must receive the same source
commit, tag, release notes, and corresponding provider-specific assets. A
release is not complete until CNB is public, marked Latest, and anonymously
downloadable, then GitHub is published as Latest and both providers pass the
online gate. Do not publish a GitHub-only or CNB-only release. If either
provider fails, leave any still-draft release unpublished and report the
blocker.

The ignored repo-local `cpa-v2-release/` directory is for release staging and generated artifacts only, not credentials.

Run the inventory helper before release or migration:

```bash
.agents/skills/cpa-v2-release-publish/scripts/check-release-dependencies.sh
```

If the local secret config is missing, copy the template first:

```bash
mkdir -p ~/.config/cpa-v2-release
cp .agents/skills/cpa-v2-release-publish/assets/release-secret-paths.env.example \
  ~/.config/cpa-v2-release/release-secret-paths.env
chmod 600 ~/.config/cpa-v2-release/release-secret-paths.env
install -m 600 /dev/null ~/.config/cpa-v2-release/cnb-release-token
```

Write the CNB token into `cnb-release-token` without echoing it, then configure:

```bash
CNB_TOKEN_FILE="$HOME/.config/cpa-v2-release/cnb-release-token"
export CNB_TOKEN="$(cat "$CNB_TOKEN_FILE")"
```

## Release Flow

From the repo root in `CPA_V2`:

### Downloadable video module: layered artifacts

New video-editor releases use module-index schema v2 and independently version shared models, each platform engine, and lightweight business/UI code. Do not copy unchanged large components into a new Release; indexes may reference their original release tags. The host keeps schema-v1 compatibility for installed users, but new releases default to v2.

Before building or publishing video-module artifacts, read [references/video-module-layered.md](references/video-module-layered.md). It defines rebuild boundaries, commands, cross-release component reuse, provider-specific signing, and public download gates.

### Downloadable cockroach module: layered artifacts

New cockroach releases use schema v2 with one shared dependency package, one small business package,
and three reusable target-specific Electron runtime packages. Before building or publishing them, read
[references/cockroach-module-layered.md](references/cockroach-module-layered.md). All public
components use the non-commercial open-source learning distribution policy while retaining upstream
license notices.

1. Confirm the tree and auth:
   ```bash
   git status --short --branch
   gh auth status
   cnb status
   git remote get-url cnb
   ```
2. Verify updater config:
   ```bash
   cd app
   npx vitest run src/updateConfig.test.ts scripts/prepare-updater-release.test.mjs \
     scripts/prepare-cnb-release.test.mjs scripts/sync-cnb-release.test.mjs
   ```
3. Build both thin macOS targets locally. Tauri `build` requires the private-key content in `TAURI_SIGNING_PRIVATE_KEY`; it does not consume `TAURI_SIGNING_PRIVATE_KEY_PATH`. Clear the path variable so newer signer versions do not receive conflicting arguments:
   ```bash
   source ~/.config/cpa-v2-release/release-secret-paths.env
   unset TAURI_SIGNING_PRIVATE_KEY_PATH
   export TAURI_SIGNING_PRIVATE_KEY="$(cat "$CPA_UPDATER_PRIVATE_KEY_PATH")"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$CPA_UPDATER_PASSWORD_PATH")"
   PATH="$RUST_TOOLCHAIN_BIN:$PATH" npm run tauri build -- \
     --target x86_64-apple-darwin --bundles app,dmg
   PATH="$RUST_TOOLCHAIN_BIN:$PATH" npm run tauri build -- \
     --target aarch64-apple-darwin --bundles app,dmg
   ```
4. Confirm both `.app` bundles have the expected architecture and a complete code signature, and verify both DMGs:
   ```bash
   file "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/桌宠番茄钟.app/Contents/MacOS/app"
   file "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/桌宠番茄钟.app/Contents/MacOS/app"
   codesign --verify --deep --strict --verbose=4 \
     "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/桌宠番茄钟.app"
   codesign --verify --deep --strict --verbose=4 \
     "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/桌宠番茄钟.app"
   hdiutil verify "src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/桌宠番茄钟_<version>_x64.dmg"
   hdiutil verify "src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/桌宠番茄钟_<version>_aarch64.dmg"
   ```
   The repo defaults macOS builds to Tauri ad-hoc signing (`bundle.macOS.signingIdentity = "-"`) so browser-downloaded Apple Silicon apps are not emitted with a broken resource seal. This is not Developer ID notarization.
5. Generate each architecture into its own temporary output directory with signing variables unset so the script reuses the fresh signatures produced by the build. Merge the two `platforms` objects into one `latest.json`; it must contain both `darwin-x86_64` and `darwin-aarch64`:
   ```bash
   x64_out="$(mktemp -d)"
   arm_out="$(mktemp -d)"
   release_stage="$(mktemp -d)"

   env -u TAURI_SIGNING_PRIVATE_KEY -u TAURI_SIGNING_PRIVATE_KEY_PATH \
     -u TAURI_SIGNING_PRIVATE_KEY_PASSWORD npm run release:updater -- \
     --notes "当前版本更新" --platform darwin-x86_64 \
     --bundle-dir src-tauri/target/x86_64-apple-darwin/release/bundle/macos \
     --out-dir "$x64_out"
   env -u TAURI_SIGNING_PRIVATE_KEY -u TAURI_SIGNING_PRIVATE_KEY_PATH \
     -u TAURI_SIGNING_PRIVATE_KEY_PASSWORD npm run release:updater -- \
     --notes "当前版本更新" --platform darwin-aarch64 \
     --bundle-dir src-tauri/target/aarch64-apple-darwin/release/bundle/macos \
     --out-dir "$arm_out"

   jq -s '.[0] as $x64 | .[1] as $arm | if $x64.version != $arm.version then error("version mismatch") else $x64 | .platforms = ($x64.platforms + $arm.platforms) end' \
     "$x64_out/stable/latest.json" "$arm_out/stable/latest.json" \
     > "$release_stage/latest.json"
   ```
6. Stage these seven stable ASCII assets, then run the mandatory local gate:
   - `latest.json`
   - `app.tar.gz` and `app.tar.gz.sig`
   - `app-aarch64.tar.gz` and `app-aarch64.tar.gz.sig`
   - `CPA_V2_<version>_x64.dmg`
   - `CPA_V2_<version>_arm64.dmg`
   ```bash
   mkdir -p "$release_stage/assets"
   cp "$x64_out/stable/<version>/app.tar.gz" "$release_stage/assets/app.tar.gz"
   cp "$x64_out/stable/<version>/app.tar.gz.sig" "$release_stage/assets/app.tar.gz.sig"
   cp "$arm_out/stable/<version>/app-aarch64.tar.gz" "$release_stage/assets/app-aarch64.tar.gz"
   cp "$arm_out/stable/<version>/app-aarch64.tar.gz.sig" "$release_stage/assets/app-aarch64.tar.gz.sig"
   cp "src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/桌宠番茄钟_<version>_x64.dmg" \
     "$release_stage/assets/CPA_V2_<version>_x64.dmg"
   cp "src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/桌宠番茄钟_<version>_aarch64.dmg" \
     "$release_stage/assets/CPA_V2_<version>_arm64.dmg"

   ../.agents/skills/cpa-v2-release-publish/scripts/validate-macos-release.sh \
     "$release_stage/latest.json" "$release_stage/assets" \
     "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/桌宠番茄钟.app" \
     "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/桌宠番茄钟.app"
   ```
7. Create the GitHub Release as a draft. Upload all six binary/signature assets first and upload the macOS `latest.json` last. Stop here by default and continue with the Windows flow; do not publish or mark Latest yet:
   ```bash
   gh release create "v<version>" "$release_stage/assets/"* \
     --repo UnityX103/CPA_V2 --target main --title "CPA_V2 <version>" \
     --notes "当前版本更新" --draft
   gh release upload "v<version>" "$release_stage/latest.json#latest.json" \
     --repo UnityX103/CPA_V2 --clobber
   ```
   A macOS-only exception still requires a matching CNB Release. Run the CNB
   mirror flow and its public gate before publishing this GitHub draft.
8. For an explicitly approved macOS-only release, re-run the same gate against the public endpoint and verify every asset returns HTTP 200. The Apple Silicon fallback assertion is mandatory because Tauri may first try `darwin-aarch64-app` and then `darwin-aarch64`:
   ```bash
   curl -fsSL -o "$release_stage/online-latest.json" \
     https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json
   ../.agents/skills/cpa-v2-release-publish/scripts/validate-macos-release.sh \
     "$release_stage/online-latest.json"
   jq -e '(.platforms["darwin-aarch64-app"] // .platforms["darwin-aarch64"])' \
     "$release_stage/online-latest.json" >/dev/null
   for release_asset in app.tar.gz app.tar.gz.sig app-aarch64.tar.gz \
     app-aarch64.tar.gz.sig CPA_V2_<version>_x64.dmg \
     CPA_V2_<version>_arm64.dmg latest.json; do
     curl -fsSL -o /dev/null \
       "https://github.com/UnityX103/CPA_V2/releases/download/v<version>/$release_asset"
   done
   ```

## Windows GitHub Release Flow

Use this path when publishing the Windows updater package.

### Parallels VM lifecycle

When `prlctl` is available, check `prlctl list -a` before treating Windows as unavailable. A full cross-platform publish request authorizes starting a suitable existing Windows VM when it is stopped; record the VM name and whether this workflow started it.

- Read [references/parallels-windows-build.md](references/parallels-windows-build.md) before building through Parallels.
- Prefer `prlctl exec` over manual UI automation when Parallels Tools is available.
- A VM started by this workflow **must be shut down before the final response**, whether publishing succeeds or fails. Use a finally-style cleanup, request a graceful Windows shutdown first, and verify `prlctl list -a` reports `stopped`.
- A VM that was already running is not owned by this workflow. Do not shut it down unless the user explicitly asked for that VM to be closed after publishing.
- Never publish Latest until Windows artifacts have been copied back to the host and the four-platform manifest gate passes. If the VM cannot produce Windows x64 artifacts, keep the release as a draft and report the blocker.

1. Confirm the local artifacts exist:
   - `app/release-updates/stable/latest.json`
   - `app/release-updates/stable/<version>/CPA_V2_<version>_x64-setup.exe`
   - `app/release-updates/stable/<version>/CPA_V2_<version>_x64-setup.exe.sig`
2. Verify updater config before upload:
   ```powershell
   cd app
   npm.cmd test -- src/updateConfig.test.ts scripts/prepare-updater-release.test.mjs
   ```
3. Upload package files to GitHub Release `v<version>`, then upload the merged `latest.json` last, but keep the GitHub Release as a draft. The manifest must preserve both `darwin-x86_64` and `darwin-aarch64` entries and include both Windows platform keys:
   ```powershell
   function Assert-UpdaterPlatforms($latest) {
     if ($latest.version -ne '<version>') {
       throw "latest.json version mismatch: $($latest.version)"
     }
     $expectedSuffixes = @{
       'darwin-x86_64' = '/app.tar.gz'
       'darwin-aarch64' = '/app-aarch64.tar.gz'
       'windows-x86_64-nsis' = '/CPA_V2_<version>_x64-setup.exe'
       'windows-x86_64' = '/CPA_V2_<version>_x64-setup.exe'
     }
     foreach ($platform in $expectedSuffixes.Keys) {
       $entry = $latest.platforms.$platform
       if (-not $entry -or -not $entry.url -or -not $entry.signature) {
         throw "latest.json is missing a complete $platform entry"
       }
       if (-not $entry.url.EndsWith($expectedSuffixes[$platform])) {
         throw "latest.json has an unexpected $platform URL: $($entry.url)"
       }
     }
   }

   $latest = Get-Content app\release-updates\stable\latest.json | ConvertFrom-Json
   Assert-UpdaterPlatforms $latest
   gh release upload v<version> app\release-updates\stable\<version>\CPA_V2_<version>_x64-setup.exe#CPA_V2_<version>_x64-setup.exe --repo UnityX103/CPA_V2 --clobber
   gh release upload v<version> app\release-updates\stable\<version>\CPA_V2_<version>_x64-setup.exe.sig#CPA_V2_<version>_x64-setup.exe.sig --repo UnityX103/CPA_V2 --clobber
   gh release upload v<version> app\release-updates\stable\latest.json#latest.json --repo UnityX103/CPA_V2 --clobber
   ```
4. Return to the host, run the complete CNB Mirror Release Flow below, and
   verify its public `latest.json`, signed module index, and large package URLs.
   Only after CNB passes may GitHub be published:
   ```bash
   gh release edit v<version> --repo UnityX103/CPA_V2 --draft=false --latest
   ```
5. Download the public `latest.json`, repeat the four-platform assertion against that downloaded object, and verify GitHub Release assets:
   ```powershell
   $onlineLatestPath = Join-Path ([System.IO.Path]::GetTempPath()) 'cpa-v2-online-latest.json'
   curl.exe -fsSL -o $onlineLatestPath https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json
   $onlineLatest = Get-Content $onlineLatestPath | ConvertFrom-Json
   Assert-UpdaterPlatforms $onlineLatest
   $releaseBase = 'https://github.com/UnityX103/CPA_V2/releases/download/v<version>'
   $assetUrls = @(
     $onlineLatest.platforms.'darwin-x86_64'.url,
     "$($onlineLatest.platforms.'darwin-x86_64'.url).sig",
     $onlineLatest.platforms.'darwin-aarch64'.url,
     "$($onlineLatest.platforms.'darwin-aarch64'.url).sig",
     $onlineLatest.platforms.'windows-x86_64-nsis'.url,
     "$($onlineLatest.platforms.'windows-x86_64-nsis'.url).sig",
     "$releaseBase/CPA_V2_<version>_x64.dmg",
     "$releaseBase/CPA_V2_<version>_arm64.dmg",
     "$releaseBase/latest.json"
   ) | Select-Object -Unique
   foreach ($url in $assetUrls) {
     curl.exe -fsSIL $url | Out-Null
     if ($LASTEXITCODE -ne 0) { throw "release asset is unavailable: $url" }
   }
   ```

## CNB Mirror Release Flow

Every public release is mirrored to `nanzhaigame-xpy/CPA_V2` on CNB. GitHub
remains the source repository, but clients prefer CNB downloads and fall back to
GitHub. If the local clone does not have the second remote, add it once:

```bash
git remote add cnb https://cnb.cool/nanzhaigame-xpy/CPA_V2.git
```

Before creating releases, push the same commit and all release tags to both
providers. Never force-push the mirror:

```bash
git push origin main --tags
git push cnb main --tags
```

Prepare CNB-specific manifests after the final GitHub `latest.json` and video
module index exist. The updater binary signatures remain valid because only the
manifest URLs change. The video module index itself is signed, so it must be
signed again after rewriting its package URLs:

```bash
cd app
npm run release:cnb:prepare -- \
  --latest /absolute/release-stage/latest.json \
  --module-index /absolute/release-stage/video-editor-module-index.json \
  --cockroach-module-index /absolute/release-stage/cockroach-module-index.json \
  --out-dir /absolute/release-stage/cnb \
  --tag v<version> \
  --repo nanzhaigame-xpy/CPA_V2

source ~/.config/cpa-v2-release/release-secret-paths.env
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$CPA_UPDATER_PASSWORD_PATH")" \
  npm run tauri -- signer sign -f "$CPA_UPDATER_PRIVATE_KEY_PATH" \
  /absolute/release-stage/cnb/video-editor-module-index.json

TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$CPA_UPDATER_PASSWORD_PATH")" \
  npm run tauri -- signer sign -f "$CPA_UPDATER_PRIVATE_KEY_PATH" \
  /absolute/release-stage/cnb/cockroach-module-index.json
```

Publish the CNB Release with `release:cnb:sync`, passing every ordinary asset
plus the CNB-specific `latest.json`, module index, and module-index signature as
repeatable `--asset` arguments. The script uploads packages first, the signed
module index next, and `latest.json` last; it verifies CNB's remote size and
hash after every upload and only then marks the Release as Latest:

```bash
source ~/.config/cpa-v2-release/release-secret-paths.env
npm run release:cnb:sync -- \
  --repo nanzhaigame-xpy/CPA_V2 \
  --tag v<version> \
  --target <release-commit> \
  --title "CPA_V2 v<version>" \
  --notes-file /absolute/release-notes.md \
  --asset /absolute/path/to/first-asset \
  --asset /absolute/release-stage/cnb/video-editor-module-index.json.sig \
  --asset /absolute/release-stage/cnb/video-editor-module-index.json \
  --asset /absolute/release-stage/cnb/cockroach-module-index.json.sig \
  --asset /absolute/release-stage/cnb/cockroach-module-index.json \
  --asset /absolute/release-stage/cnb/latest.json
```

`CNB_TOKEN` must include `repo-release:rw` for the target repository. Load it
only from `~/.config/cpa-v2-release/cnb-release-token` through the user-level
config above; `cnb login` alone may not grant Release scope. Never print the token. CNB Release
attachments accept files up to 64 GiB, so individual video-module components do
not need transport-level splitting. Use `ttl=0` (the sync script default) so public release
assets do not expire.

Validate the public mirror before publishing GitHub Latest:

```bash
curl -fsSL \
  https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/latest.json \
  | jq -e '.platforms["darwin-aarch64"] and .platforms["darwin-x86_64"] and .platforms["windows-x86_64-nsis"] and .platforms["windows-x86_64"]'
curl -fsSL \
  https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/video-editor-module-index.json \
  | jq -e 'if .schemaVersion == 2 then .logic and .models and .engines["macos-arm64"] and .engines["macos-x86_64"] and .engines["windows-x86_64"] else .packages["macos-arm64"] and .packages["macos-x86_64"] and .packages["windows-x86_64"] end'
curl -fsSL \
  https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/cockroach-module-index.json \
  | jq -e '.schemaVersion == 2 and .distribution == "noncommercial-open-source" and .logic and .dependencies and .runtimes["macos-arm64"] and .runtimes["macos-x86_64"] and .runtimes["windows-x86_64"]'
```

If CNB mirroring fails, keep the GitHub Release as a draft. There is no
GitHub-only release exception. Do not upload one provider's rewritten
video-module index to the other provider: their URLs differ and each index has
its own Minisign signature.

### Mandatory completion gate

Before reporting a release complete, all of these must be true:

- `origin` and `cnb` resolve the release branch and tag to the same commit.
- The CNB Release is not a draft, is Latest, and contains every expected asset.
- CNB `latest.json` contains all four updater platform keys and only CNB binary URLs.
- The CNB module index and `.sig` match; every v2 logic/models/engine URL (or legacy v1 package URL) is present, and its signed `mirrors` list contains the corresponding GitHub URL.
- The CNB cockroach index and `.sig` match; its logic/runtime URLs are present on both providers,
  declare the non-commercial distribution, and retain GitHub mirrors.
- Anonymous Range requests succeed for every large CNB video-module package.
- The GitHub Release is not a draft, is Latest, and contains every expected asset.
- GitHub `latest.json` and its provider-specific signed module index pass the existing online gates.

## Important Gotchas

- Current updater endpoints are CNB first and GitHub fallback:
  `https://cnb.cool/nanzhaigame-xpy/CPA_V2/-/releases/latest/download/latest.json`, then `https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json`.
- Do not use `updates.nanzhaigame.cn` for new releases. It is a legacy endpoint kept only for old diagnostics.
- GitHub normalizes non-ASCII asset names. Use ASCII release asset names for updater artifacts and DMGs, including `app.tar.gz`, `app-aarch64.tar.gz`, `CPA_V2_<version>_x64.dmg`, and `CPA_V2_<version>_arm64.dmg`.
- macOS public releases are always two thin artifacts. `darwin-x86_64` uses `app.tar.gz`; `darwin-aarch64` uses `app-aarch64.tar.gz`. A single-architecture manifest is a release-blocking error.
- Never overwrite a public `latest.json` and assume GitHub CDN invalidated the previous object. If clients still receive stale metadata after a bad publication, publish a new patch version whose complete manifest exists before it becomes Latest.
- Do not use `--no-sign` for published macOS packages. It can leave the bundle with an invalid resource seal and produce a browser-downloaded app that macOS reports as damaged.
- The default ad-hoc signature is only a fallback. Without Developer ID + notarization, users may still need to approve the app in Privacy & Security. A polished public macOS release requires installing a Developer ID Application certificate and setting notarization credentials (`APPLE_API_KEY`/`APPLE_API_ISSUER`/`APPLE_API_KEY_PATH`, or the Apple ID flow) before rebuilding.
- If a downloaded DMG installs an app that macOS says is damaged, check with `hdiutil verify`, `codesign --verify --deep --strict`, `spctl --assess`, and `syspolicy_check distribution`. If `syspolicy_check` reports `Notary Ticket Missing`, the remaining blocker is Apple notarization, not the Tauri updater signature.
- Windows releases must be built on Windows and then merged into `latest.json`; do not overwrite the existing macOS platform entry.
- A normal cross-platform GitHub release stays draft after macOS and Windows upload. Only the CNB flow may unlock GitHub publication after both providers have all four updater platform entries. macOS-only publication is an explicit platform exception requiring user approval, but it still must be mirrored to CNB.
- The macOS release gate must inspect every Mach-O file in both `.app` bundles with `lipo`. The x64 bundle may contain only `x86_64`, the ARM bundle only `arm64`; any fat/Universal or mislabeled Mach-O blocks publication.
- On Windows, the Bash inventory helper may be unavailable. Do the equivalent checks in PowerShell: `git status --short --branch`, `gh auth status`, release artifact existence, and updater tests.
- Upload `latest.json` last so clients never see metadata for package files that are still transferring.

## References

- Migration and secret paths: `references/migration.md`
- Helper script: `scripts/check-release-dependencies.sh`
- Mandatory macOS release gate: `scripts/validate-macos-release.sh`
- Secret config template: `assets/release-secret-paths.env.example`
