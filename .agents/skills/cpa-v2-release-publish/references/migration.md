# CPA_V2 Release Migration

Use this when moving release capability to another Mac or Windows machine.

## Secret Path Config

The canonical self-contained credential pack lives inside the repo root:

```bash
CPA_V2/cpa-v2-release/
```

That directory is ignored by Git. It should contain:

```bash
cpa-v2-release/release-secret-paths.env
```

The config derives `CPA_V2_REPO` from its own directory, so it does not need to store the machine-specific project path. The files named by the key path variables live next to the config file.

For compatibility with existing helper scripts, `~/.config/cpa-v2-release/release-secret-paths.env` can be a shim that sources the repo-local config.

## Files To Migrate

Copy the whole `cpa-v2-release/` directory securely. It should contain these files:

```text
CPA_UPDATER_PRIVATE_KEY_PATH     Tauri updater private key
CPA_UPDATER_PASSWORD_PATH        Password for the updater private key
CPA_UPDATER_PUBLIC_KEY_PATH      Public updater key, safe to inspect
GITHUB_SSH_KEY_PATH              GitHub SSH private key for git push
REMOTE_NANZHAI_SSH_KEY_PATH      Legacy SSH private key for 139.159.233.218, not used for new releases
```

Also restore `gh auth login`; the GitHub token is stored by GitHub CLI/keychain and should not be copied as plaintext.

## New Machine Checklist

1. Install Node, npm, Rust stable, Tauri prerequisites, GitHub CLI, Xcode command line tools.
2. Copy `cpa-v2-release/` into the CPA_V2 repo root on the new machine.
3. Set `chmod 700 cpa-v2-release` and `chmod 600` for private keys and password files.
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
