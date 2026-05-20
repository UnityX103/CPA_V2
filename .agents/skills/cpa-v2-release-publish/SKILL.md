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
   PATH="$RUST_TOOLCHAIN_BIN:$PATH" npm run tauri build -- --no-sign
   ```
4. Sign the updater tarball using `CPA_UPDATER_PRIVATE_KEY_PATH` and `CPA_UPDATER_PASSWORD_PATH` from the secret path config.
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
- `--no-sign` skips Apple code signing and notarization. It is acceptable for local packaging but not a polished public macOS release.
- If a downloaded DMG installs an app that macOS says is damaged, check with `hdiutil verify`, `codesign --verify --deep --strict`, and `spctl --assess`. Without Developer ID + notarization, users may need to remove quarantine manually.
- Windows releases must be built on Windows and then merged into `latest.json`; do not overwrite the existing macOS platform entry.
- On Windows, the Bash inventory helper may be unavailable. Do the equivalent checks in PowerShell: `git status --short --branch`, `gh auth status`, release artifact existence, and updater tests.
- Upload `latest.json` last so clients never see metadata for package files that are still transferring.

## References

- Migration and secret paths: `references/migration.md`
- Helper script: `scripts/check-release-dependencies.sh`
- Secret config template: `assets/release-secret-paths.env.example`
