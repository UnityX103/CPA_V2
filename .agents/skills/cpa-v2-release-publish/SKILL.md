---
name: cpa-v2-release-publish
description: Configure, test, package, publish, or troubleshoot CPA_V2 GitHub Actions releases and the asynchronous CNB download mirror. Build and publish through GitHub CI/CD.
---

# CPA_V2 Cloud Release

## Authoritative workflow

Read [cloud-release.md](../../../docs/deployment/cloud-release.md). GitHub is the release source; CNB mirrors publicly published Latest asynchronously. This replaces all historical CNB-first/two-provider transaction gates in this skill's references and old research/plans.

- Use `.github/workflows/ci.yml` for frontend, Server and native macOS/Windows tests.
- Use `.github/workflows/release.yml` for three-target packaging. Manual runs default to validation only. Publishing requires a new matching app version on main or a matching version tag belonging to main.
- Never silently bump or overwrite an existing public version. Keep partial GitHub uploads as drafts; publish only after all native targets and updater signatures pass.
- CNB uses `.cnb.yml` to run `app/scripts/mirror-github-release.mjs` every 15 minutes. It reads GitHub anonymously, verifies packages and index signatures, imports matching tags, writes only CNB using its temporary token, and advances its own Latest after verification. CNB failures do not block GitHub publication.

## Cloud-only default

- Source hosting and code management use `https://github.com/UnityX103/CPA_V2`; `origin` points to GitHub. CNB is the mainland release mirror.
- Do not run local release builds, start Parallels, or upload locally built installers for an ordinary release request. Commit the requested version and release notes to GitHub, trigger `Release` with `publish=true`, and follow the cloud run through publication. Do not invent a new version or overwrite an existing public release.
- A validation-only run uses `publish=false`. Local lint/unit tests are allowed; they are not local release packaging.
- Confirm the GitHub Release is public, trigger or wait for CNB synchronization, and verify both public manifests and attachments. Report actual run URLs and separate build, publish, and mirror status.

## Update source policy

`app/src-tauri/src/app_update.rs` queries both public manifests with bounded timeouts and uses semantic versions. At equal versions use CNB; when GitHub has a newer available version use GitHub, including when CNB reports no update for the installed client. If GitHub cannot be reached, use an available CNB update; if freshness cannot be established and neither source provides an update, report the check error instead of claiming the client is current. Retain the plugin's package signature verification. Endpoint order alone does not implement this policy.

This policy requires a new client build; do not imply previously published 0.1.32 installers contain a later source change.

## Secrets

Never print, paste into logs, commit, or attach private keys, tokens, passwords or credential packs to releases. Local administrative credentials stay outside the repository under `~/.config/cpa-v2-release/`. Never upload the ignored `cpa-v2-release/` credential staging directory.

Provision updater key/password through GitHub encrypted Secrets only within the user's authorization for cloud release setup; use stdin, never command arguments containing secrets. Keep the existing updater key for client compatibility. GitHub must contain no CNB credential in code, commit history, repository/environment/organization Secrets exposed to this repo, Variables, workflow inputs, logs, or artifacts. A `CNB_TOKEN` environment-variable name in CNB-only code is not a credential value. When auditing, compare known credentials without printing them and report only finding paths. GitHub gets no CNB write token. CNB gets no GitHub token or signing key. Public download requests must never attach CNB credentials.

## Artifact invariants

- macOS x86_64 and aarch64 are separate thin packages. No Universal builds. Windows x86_64 NSIS only unless Windows ARM64 is explicitly requested.
- Require darwin-x86_64, darwin-aarch64, windows-x86_64-nsis and windows-x86_64 updater keys with valid signatures. Verify every Mach-O architecture and macOS resource seal. Never publish `--no-sign` bundles.
- Current CI uses ad-hoc macOS signing. Report that it is not Developer ID or Apple notarization; do not imply otherwise. Adding notarization is separate credential/configuration work.
- Prepare signed CNB index variants in the trusted GitHub signing job. CNB may rewrite unsigned updater URLs, but cannot mutate a signed index. Preserve signed GitHub fallback URLs and verify reused package hashes.
- Mirror all latest-release attachments and dependencies referenced at old release tags. Do not repeatedly rebuild/copy unchanged large runtime/model packages into each app release.
- Main-app cloud releases carry forward the previous extension indexes; publishing changed extension logic/runtimes needs the relevant module build workflow first.

## Validation and completion

- Run release-script tests, frontend build, Server tests, actionlint and the cnb-pipeline skill validators when applicable.
- Exercise anonymous mirror discovery with `--dry-run` before a live mirror.
- A configured workflow is not a proven cloud build: report run links/status and any remaining secret, build or signing blockers separately.
- Distinguish GitHub publication completion from asynchronous CNB mirror completion.
- Run `graphify update .` before reporting completion.

## Historical local references

These references are historical and are not the default publishing route. Read local packaging instructions only if the user later explicitly requests a local fallback. Old CNB-before-GitHub gates are obsolete.

- `references/parallels-windows-build.md`: explicit local Windows fallback; stop only VMs started by the task.
- `references/video-module-layered.md`, `references/cockroach-module-layered.md`: independently versioned extension packages.
- `references/migration.md`: local tool and credential paths.
- `scripts/validate-macos-release.sh`: thin-bundle and updater verification.
