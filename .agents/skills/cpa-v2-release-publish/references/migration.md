# CPA_V2 Release Migration

Use this when moving release capability to another Mac or Windows machine.

## Secret Path Config

The canonical local config is:

```bash
~/.config/cpa-v2-release/release-secret-paths.env
```

It contains only paths and public identifiers. The files named by those paths contain the sensitive data.

For this repo, keep copied key files under the ignored project-local directory:

```bash
.local/release-secrets/
```

## Files To Migrate

Copy these files securely to the same paths, or update the config paths on the new machine:

```text
CPA_UPDATER_PRIVATE_KEY_PATH     Tauri updater private key
CPA_UPDATER_PASSWORD_PATH        Password for the updater private key
CPA_UPDATER_PUBLIC_KEY_PATH      Public updater key, safe to inspect
GITHUB_SSH_KEY_PATH              GitHub SSH private key for git push
REMOTE_NANZHAI_SSH_KEY_PATH      SSH private key for 139.159.233.218, only needed for legacy server upload
```

Also restore `gh auth login`; the GitHub token is stored by GitHub CLI/keychain and should not be copied as plaintext.

## New Machine Checklist

1. Install Node, npm, Rust stable, Tauri prerequisites, GitHub CLI, Xcode command line tools.
2. Copy or recreate `~/.config/cpa-v2-release/release-secret-paths.env`.
3. Copy secret files into `.local/release-secrets/` with `chmod 600` for private keys and password files.
4. Update `RUST_TOOLCHAIN_BIN` if the Rust toolchain path differs.
5. Confirm:
   ```bash
   gh auth status
   ssh -T git@github.com
   .agents/skills/cpa-v2-release-publish/scripts/check-release-dependencies.sh
   ```
6. In `CPA_V2/app`, run focused updater tests before publishing.

## Apple Signing

This machine currently had no valid Apple code signing identity. A public macOS release that opens without quarantine warnings needs:

```text
Developer ID Application certificate
Apple notarization credentials or notarytool keychain profile
```

Do not store Apple passwords in this skill. Put only keychain profile names or credential paths in the secret path config.
