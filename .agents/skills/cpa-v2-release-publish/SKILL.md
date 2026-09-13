---
name: cpa-v2-release-publish
description: Configure, test, package, publish, or troubleshoot CPA_V2 GitHub Actions releases and the asynchronous CNB download mirror; use local release tooling only for an explicit local fallback.
---

# CPA_V2 Cloud Release

## Authoritative workflow

Read [cloud-release.md](../../../docs/deployment/cloud-release.md) from the repository root (`docs/deployment/cloud-release.md`; resolve this repository path directly). GitHub is the release source; CNB mirrors publicly published Latest asynchronously. This replaces all historical CNB-first/two-provider transaction gates in this skill's references and old research/plans.

- Use `.github/workflows/ci.yml` for frontend, Server and native macOS/Windows tests.
- Use `.github/workflows/release.yml` for three-target packaging. Manual runs default to validation only. Publishing requires a new matching app version on main or a matching version tag belonging to main.
- Never silently bump or overwrite an existing public version. Keep partial GitHub uploads as drafts; publish only after all native targets and updater signatures pass.
- CNB uses `.cnb.yml` to run `app/scripts/mirror-github-release.mjs` every 15 minutes. It reads GitHub anonymously, verifies packages and index signatures, imports matching tags, writes only CNB using its temporary token, and advances its own Latest after verification. CNB failures do not block GitHub publication.

## Secrets

Never print, paste into logs, commit, or attach private keys, tokens, passwords or credential packs to releases. Local fallback uses `~/.config/cpa-v2-release/release-secret-paths.env`; CNB local credentials stay in `~/.config/cpa-v2-release/cnb-release-token`, mode 600. Repo-local `cpa-v2-release/` is staging only.

Provision updater key/password through GitHub encrypted Secrets only within the user's authorization for cloud release setup; use stdin, never command arguments containing secrets. Keep the existing updater key for client compatibility. GitHub gets no CNB write token. CNB gets no GitHub token or signing key. Public download requests must never attach CNB credentials.

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

## Optional local fallback references

Read only for the requested operation. Commands and packaging details remain useful; any old CNB-before-GitHub gating is obsolete.

- `references/parallels-windows-build.md`: explicit local Windows fallback; stop only VMs started by the task.
- `references/video-module-layered.md`, `references/cockroach-module-layered.md`: independently versioned extension packages.
- `references/migration.md`: local tool and credential paths.
- `scripts/validate-macos-release.sh`: thin-bundle and updater verification.
