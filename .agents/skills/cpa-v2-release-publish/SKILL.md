---
name: cpa-v2-release-publish
description: Use when packaging CPA_V2, publishing Tauri updater artifacts to GitHub Releases, checking macOS DMG/Gatekeeper issues, or migrating CPA_V2 release keys to another computer.
---

# CPA_V2 Release Publish

## Core Rule

Treat release signing keys, GitHub tokens, Apple credentials, and SSH private keys as local secrets. Never print, paste, commit, or upload secret contents. Keep the self-contained credential pack in the repo root at:

```bash
cpa-v2-release/
```

This directory is ignored by Git and should contain `release-secret-paths.env` plus the key files it references. The global config can be a tiny shim that sources the repo-local config:

```bash
~/.config/cpa-v2-release/release-secret-paths.env
```

Run the inventory helper before release or migration:

```bash
.agents/skills/cpa-v2-release-publish/scripts/check-release-dependencies.sh
```

If the local secret config is missing, copy the template first:

```bash
mkdir -p ~/.config/cpa-v2-release
mkdir -p cpa-v2-release
cp .agents/skills/cpa-v2-release-publish/assets/release-secret-paths.env.example \
  cpa-v2-release/release-secret-paths.env
printf 'source "%s/cpa-v2-release/release-secret-paths.env"\n' "$(pwd)" \
  > ~/.config/cpa-v2-release/release-secret-paths.env
```

## Release Flow

From the repo root in `CPA_V2`:

1. Confirm the tree and auth:
   ```bash
   git status --short --branch
   gh auth status
   ```
2. Verify updater config:
   ```bash
   cd app
   npx vitest run src/updateConfig.test.ts scripts/prepare-updater-release.test.mjs
   ```
3. Build macOS locally:
   ```bash
   source ~/.config/cpa-v2-release/release-secret-paths.env
   export TAURI_SIGNING_PRIVATE_KEY="$(cat "$CPA_UPDATER_PRIVATE_KEY_PATH")"
   export TAURI_SIGNING_PRIVATE_KEY_PATH="$CPA_UPDATER_PRIVATE_KEY_PATH"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$CPA_UPDATER_PASSWORD_PATH")"
   PATH="$RUST_TOOLCHAIN_BIN:$PATH" npm run tauri build -- --bundles app,dmg
   ```
4. Confirm the `.app` bundle has a complete code signature before publishing:
   ```bash
   codesign --verify --deep --strict --verbose=4 \
     "src-tauri/target/release/bundle/macos/桌宠番茄钟.app"
   ```
   The repo defaults macOS builds to Tauri ad-hoc signing (`bundle.macOS.signingIdentity = "-"`) so browser-downloaded Apple Silicon apps are not emitted with a broken resource seal. This is not Developer ID notarization.
5. Generate updater release files:
   ```bash
   rm -rf release-updates
   npm run release:updater -- --notes "当前版本更新" --platform darwin-aarch64
   ```
6. Upload GitHub Release assets with stable ASCII names. Create or update tag `v<version>` and mark it as latest:
   - `app/release-updates/stable/latest.json`
   - `app/release-updates/stable/<version>/app.tar.gz`
   - `app/release-updates/stable/<version>/app.tar.gz.sig`
   - DMG copied to `/tmp/CPA_V2_<version>_aarch64.dmg`
   ```bash
   gh release create "v<version>" \
     app/release-updates/stable/latest.json#latest.json \
     app/release-updates/stable/<version>/app.tar.gz#app.tar.gz \
     app/release-updates/stable/<version>/app.tar.gz.sig#app.tar.gz.sig \
     /tmp/CPA_V2_<version>_aarch64.dmg#CPA_V2_<version>_aarch64.dmg \
     --repo UnityX103/CPA_V2 --target main --title "CPA_V2 <version>" \
     --notes "当前版本更新" --latest
   ```
   If the release already exists, use `gh release upload v<version> ... --repo UnityX103/CPA_V2 --clobber` for each asset instead.
7. Verify:
   ```bash
   curl -fsSL https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json
   curl -I -L https://github.com/UnityX103/CPA_V2/releases/download/v<version>/app.tar.gz
   curl -I -L https://github.com/UnityX103/CPA_V2/releases/download/v<version>/CPA_V2_<version>_aarch64.dmg
   codesign --verify --deep --strict --verbose=4 \
     "src-tauri/target/release/bundle/macos/桌宠番茄钟.app"
   syspolicy_check distribution "src-tauri/target/release/bundle/macos/桌宠番茄钟.app"
   ```

## Windows GitHub Release Flow

Use this path when publishing the Windows updater package.

1. Confirm the local artifacts exist:
   - `app/release-updates/stable/latest.json`
   - `app/release-updates/stable/<version>/CPA_V2_<version>_x64-setup.exe`
   - `app/release-updates/stable/<version>/CPA_V2_<version>_x64-setup.exe.sig`
2. Verify updater config before upload:
   ```powershell
   cd app
   npm.cmd test -- src/updateConfig.test.ts scripts/prepare-updater-release.test.mjs
   ```
3. Upload package files to GitHub Release `v<version>`, then upload the merged `latest.json` last. The manifest must preserve macOS entries and include both Windows platform keys:
   ```powershell
   gh release upload v<version> app\release-updates\stable\<version>\CPA_V2_<version>_x64-setup.exe#CPA_V2_<version>_x64-setup.exe --repo UnityX103/CPA_V2 --clobber
   gh release upload v<version> app\release-updates\stable\<version>\CPA_V2_<version>_x64-setup.exe.sig#CPA_V2_<version>_x64-setup.exe.sig --repo UnityX103/CPA_V2 --clobber
   gh release upload v<version> app\release-updates\stable\latest.json#latest.json --repo UnityX103/CPA_V2 --clobber
   ```
4. Verify GitHub Release assets:
   ```powershell
   curl.exe -fsSL https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json
   curl.exe -I -L https://github.com/UnityX103/CPA_V2/releases/download/v<version>/CPA_V2_<version>_x64-setup.exe
   curl.exe -I -L https://github.com/UnityX103/CPA_V2/releases/download/v<version>/CPA_V2_<version>_x64-setup.exe.sig
   ```

## Important Gotchas

- Current updater endpoint is GitHub Releases:
  `https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json`
- Do not use `updates.nanzhaigame.cn` for new releases. It is a legacy endpoint kept only for old diagnostics.
- GitHub normalizes non-ASCII asset names. Use ASCII release asset names for updater artifacts (`app.tar.gz`, `app.tar.gz.sig`) and DMG (`CPA_V2_<version>_aarch64.dmg`).
- Do not use `--no-sign` for published macOS packages. It can leave the bundle with an invalid resource seal and produce a browser-downloaded app that macOS reports as damaged.
- The default ad-hoc signature is only a fallback. Without Developer ID + notarization, users may still need to approve the app in Privacy & Security. A polished public macOS release requires installing a Developer ID Application certificate and setting notarization credentials (`APPLE_API_KEY`/`APPLE_API_ISSUER`/`APPLE_API_KEY_PATH`, or the Apple ID flow) before rebuilding.
- If a downloaded DMG installs an app that macOS says is damaged, check with `hdiutil verify`, `codesign --verify --deep --strict`, `spctl --assess`, and `syspolicy_check distribution`. If `syspolicy_check` reports `Notary Ticket Missing`, the remaining blocker is Apple notarization, not the Tauri updater signature.
- Windows releases must be built on Windows and then merged into `latest.json`; do not overwrite the existing macOS platform entry.
- On Windows, the Bash inventory helper may be unavailable. Do the equivalent checks in PowerShell: `git status --short --branch`, `gh auth status`, release artifact existence, and updater tests.
- Upload `latest.json` last so clients never see metadata for package files that are still transferring.

## References

- Migration and secret paths: `references/migration.md`
- Helper script: `scripts/check-release-dependencies.sh`
- Secret config template: `assets/release-secret-paths.env.example`
