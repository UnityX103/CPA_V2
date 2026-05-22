# Windows Update Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the current branch with remote `main`, preserve the GitHub Releases updater endpoint, fix any Windows compatibility issues found in the updated code, and publish the Windows updater artifacts.

**Architecture:** Treat `origin/main` as the release baseline because it contains `v0.1.8`. Keep updater generation in `app/scripts/prepare-updater-release.mjs`, updater endpoint tests in `app/src/updateConfig.test.ts`, and Tauri package metadata in `app/src-tauri`. Windows publishing must upload package files before `latest.json`.

**Tech Stack:** Git, PowerShell, Node/Vitest, Tauri 2, Rust/Cargo, GitHub CLI.

---

### Task 1: Synchronize Branch State

**Files:**
- Inspect: `app/src-tauri/Cargo.toml`
- Modify only if needed: `app/src-tauri/Cargo.toml`

- [ ] **Step 1: Inspect current git state**

Run: `git status --short --branch`
Expected: shows current branch, ahead/behind counts, and any dirty files.

- [ ] **Step 2: Inspect the dirty Cargo manifest**

Run: `git diff -- app/src-tauri/Cargo.toml`
Expected: either no semantic diff or a version/config diff that must be preserved.

- [ ] **Step 3: Integrate remote `main`**

Run: `git pull --rebase origin main`
Expected: local branch includes `origin/main` commits. If the local CDN endpoint commit conflicts with GitHub Releases endpoint requirements, keep the GitHub Releases endpoint.

- [ ] **Step 4: Re-check state**

Run: `git status --short --branch`
Expected: no unresolved conflicts.

### Task 2: Preserve Updater Endpoint and Manifest Behavior

**Files:**
- Modify: `app/src-tauri/tauri.conf.json`
- Modify: `app/src/updateConfig.test.ts`
- Modify: `app/scripts/prepare-updater-release.mjs`
- Modify: `app/scripts/prepare-updater-release.test.mjs`

- [ ] **Step 1: Write or adjust endpoint tests first**

Ensure `app/src/updateConfig.test.ts` asserts the updater endpoint is exactly `https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json`.

- [ ] **Step 2: Run endpoint tests**

Run: `cd app; npm.cmd test -- src/updateConfig.test.ts`
Expected: fail if the app still points at `updates.nanzhaigame.cn`; pass after the config is corrected.

- [ ] **Step 3: Correct endpoint config**

Update `app/src-tauri/tauri.conf.json` so `plugins.updater.endpoints` contains the GitHub Releases latest manifest URL.

- [ ] **Step 4: Verify updater release tests**

Run: `cd app; npm.cmd test -- src/updateConfig.test.ts scripts/prepare-updater-release.test.mjs`
Expected: all tests pass and Windows manifest generation includes both `windows-x86_64-nsis` and `windows-x86_64` without removing macOS entries.

### Task 3: Audit Windows Compatibility

**Files:**
- Inspect: `app/src-tauri/src/**/*.rs`
- Inspect: `app/src/**/*.{ts,tsx}`
- Modify any Windows-incomplete native bridge only if it blocks Windows build, packaging, or updater behavior.

- [ ] **Step 1: Search for macOS-only stubs and platform gates**

Run: `rg -n "not\\(target_os = \"macos\"\\)|target_os = \"macos\"|target_os = \"windows\"|cfg\\(" app/src-tauri/src app/src`
Expected: list of platform-specific code to review.

- [ ] **Step 2: Compare native command surface**

Run: `rg -n "#\\[tauri::command\\]|invoke\\(" app/src-tauri/src app/src`
Expected: every frontend invoke has a Tauri command available on Windows, even if existing behavior is a documented no-op.

- [ ] **Step 3: Add regression tests for script/config compatibility if a gap is found**

Run the smallest relevant Vitest command first and confirm failure before changing production code.

- [ ] **Step 4: Implement the minimal compatibility fix**

Fix only release-blocking or updater-blocking Windows incompatibilities discovered by the audit.

### Task 4: Build and Package Windows Artifacts

**Files:**
- Generated: `app/release-updates/stable/latest.json`
- Generated: `app/release-updates/stable/0.1.8/CPA_V2_0.1.8_x64-setup.exe`
- Generated: `app/release-updates/stable/0.1.8/CPA_V2_0.1.8_x64-setup.exe.sig`

- [ ] **Step 1: Verify frontend build**

Run: `cd app; npm.cmd run build`
Expected: TypeScript and Vite build exit 0.

- [ ] **Step 2: Verify GitHub auth**

Run: `gh auth status`
Expected: authenticated for `github.com` with permission to upload releases.

- [ ] **Step 3: Build signed Windows bundle**

Run from `app` with release signing environment loaded from `cpa-v2-release`: `npm.cmd run tauri -- build`
Expected: Windows installer and updater signature are generated.

- [ ] **Step 4: Generate updater release directory**

Run: `cd app; npm.cmd run release:updater -- --notes "当前版本更新" --platform windows-x86_64`
Expected: `release-updates/stable/latest.json`, `.exe`, and `.sig` exist for version `0.1.8`.

### Task 5: Commit, Push, and Publish

**Files:**
- Commit source/test/config changes only.
- Do not commit generated release artifacts unless the repository already tracks them.

- [ ] **Step 1: Commit source changes**

Run: `git status --short`, then `git add <changed source files>`, then `git commit -m "fix: publish windows updater from github releases"` if there are source changes.
Expected: commit contains only intentional source/test/config changes.

- [ ] **Step 2: Push main**

Run: `git push origin main`
Expected: remote `main` contains the synchronized and fixed commit history.

- [ ] **Step 3: Upload Windows release assets**

Run:
```powershell
gh release upload v0.1.8 app\release-updates\stable\0.1.8\CPA_V2_0.1.8_x64-setup.exe#CPA_V2_0.1.8_x64-setup.exe --repo UnityX103/CPA_V2 --clobber
gh release upload v0.1.8 app\release-updates\stable\0.1.8\CPA_V2_0.1.8_x64-setup.exe.sig#CPA_V2_0.1.8_x64-setup.exe.sig --repo UnityX103/CPA_V2 --clobber
gh release upload v0.1.8 app\release-updates\stable\latest.json#latest.json --repo UnityX103/CPA_V2 --clobber
```
Expected: assets upload successfully, with `latest.json` uploaded last.

- [ ] **Step 4: Verify public release assets**

Run:
```powershell
curl.exe -fsSL https://github.com/UnityX103/CPA_V2/releases/latest/download/latest.json
curl.exe -I -L https://github.com/UnityX103/CPA_V2/releases/download/v0.1.8/CPA_V2_0.1.8_x64-setup.exe
curl.exe -I -L https://github.com/UnityX103/CPA_V2/releases/download/v0.1.8/CPA_V2_0.1.8_x64-setup.exe.sig
```
Expected: manifest downloads and both package URLs return HTTP 200.
