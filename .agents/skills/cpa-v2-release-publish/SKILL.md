---
name: cpa-v2-release-publish
description: Use when packaging CPA_V2, publishing Tauri updater artifacts, uploading GitHub Releases assets, checking macOS DMG/Gatekeeper issues, or migrating CPA_V2 release keys to another computer.
---

# CPA_V2 Release Publish

## Core Rule

Treat release signing keys, GitHub tokens, Apple credentials, and SSH private keys as local secrets. Never print, paste, commit, or upload secret contents. Use the path config at:

```bash
~/.config/cpa-v2-release/release-secret-paths.env
```

Keep the actual key files in the repo-local ignored directory:

```bash
.local/release-secrets/
```

Run the inventory helper before release or migration:

```bash
.agents/skills/cpa-v2-release-publish/scripts/check-release-dependencies.sh
```

If the local secret config is missing, copy the template first:

```bash
mkdir -p ~/.config/cpa-v2-release
mkdir -p .local/release-secrets
cp .agents/skills/cpa-v2-release-publish/assets/release-secret-paths.env.example \
  ~/.config/cpa-v2-release/release-secret-paths.env
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
6. Upload GitHub Release assets with stable ASCII names:
   - `app/release-updates/stable/latest.json`
   - `app/release-updates/stable/<version>/app.tar.gz`
   - `app/release-updates/stable/<version>/app.tar.gz.sig`
   - DMG copied to `/tmp/CPA_V2_<version>_aarch64.dmg`
7. Verify:
   ```bash
   curl -fsSL https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json
   curl -I -L https://github.com/UnityX103/CPA_V2/releases/download/v0.1.0/CPA_V2_0.1.0_aarch64.dmg
   ```

## Important Gotchas

- Current updater endpoint should be GitHub Releases:
  `https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json`
- GitHub normalizes non-ASCII asset names. Use ASCII release asset names for updater artifacts (`app.tar.gz`, `app.tar.gz.sig`) and DMG (`CPA_V2_<version>_aarch64.dmg`).
- `--no-sign` skips Apple code signing and notarization. It is acceptable for local packaging but not a polished public macOS release.
- If a downloaded DMG installs an app that macOS says is damaged, check with `hdiutil verify`, `codesign --verify --deep --strict`, and `spctl --assess`. Without Developer ID + notarization, users may need to remove quarantine manually.
- Windows releases must be built on Windows and then merged into `latest.json`; do not overwrite the existing macOS platform entry.

## References

- Migration and secret paths: `references/migration.md`
- Helper script: `scripts/check-release-dependencies.sh`
- Secret config template: `assets/release-secret-paths.env.example`
