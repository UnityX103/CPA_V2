# Silent Background Updates Design

**Date**: 2026-05-18
**Scope**: Add first-version background update support for the CPA_V2 Tauri app using the official Tauri 2 updater, a self-hosted static CDN manifest, and a local release packaging script.

## Goal

CPA_V2 should check for updates in the background, download and install trusted update packages without interrupting the user, then wait for the user to restart the app when convenient. The app must not restart automatically during a Pomodoro focus session or any other active workflow.

The first release channel is `stable`. The architecture keeps channel as a release-side concept so beta support can be added later, but the app UI does not expose channel selection in this pass.

## Confirmed Product Decisions

- Update hosting uses a self-owned server or CDN with static files.
- Runtime behavior is silent check, silent download, silent install, then a user-controlled restart prompt.
- Automatic updates are enabled by default and can be disabled in Settings.
- The app checks after startup delay and then periodically while running.
- The first version only enables `stable`, while keeping the update URL structure channel-ready.
- The first implementation includes a local release script that prepares the CDN upload directory, but does not upload it.

## Architecture

Use the official Tauri 2 updater rather than a custom downloader. Tauri's updater requires signed update packages, and signature verification cannot be disabled. This is the right boundary for this feature: the app delegates package integrity and platform-specific installation to Tauri, while CPA_V2 owns scheduling, settings, status, and release packaging.

Add a small frontend domain module:

- `app/src/domain/appUpdate.ts`
  - owns update state, scheduling, and user-facing status transitions.
  - calls the Tauri updater guest API for check, download, and install.
  - calls the process plugin only when the user chooses to relaunch.

If the JavaScript updater API is sufficient, do not add new privileged Rust commands. Rust integration is limited to initializing plugins in `app/src-tauri/src/lib.rs` and configuring the updater in `app/src-tauri/tauri.conf.json`.

Required Tauri-side changes:

- Add `tauri-plugin-updater`.
- Add `tauri-plugin-process` for relaunch.
- Configure updater endpoints in `tauri.conf.json`.
- Configure updater public key in `tauri.conf.json`.
- Set `bundle.createUpdaterArtifacts` so release builds emit updater packages and signatures.
- Add only the updater/process permissions needed by the frontend. Do not broaden CSP or add unrelated capabilities.

## Runtime Flow

On app startup:

1. The main window initializes the app update service.
2. The service waits about 30 seconds before the first automatic check.
3. If automatic updates are disabled, the check exits early and reports `disabled`.
4. If enabled, the service calls updater `check()`.
5. If no update exists, state becomes `upToDate`.
6. If an update exists, the service downloads and installs it in the background.
7. When installation finishes, state becomes `readyToRestart`.
8. The UI shows a low-interruption prompt saying the new version is ready and will apply after restart.
9. The app restarts only after the user clicks the restart action.

Periodic checks run every 6 hours after the first startup check. The interval may stay scheduled while automatic updates are disabled, but each tick must re-read the setting and skip network work if disabled.

Development mode should not run automatic update checks by default. This avoids confusing `tauri dev` with release-only signing, installed bundle IDs, and test endpoints.

## Settings And UI

Add one Global settings item:

- Label: `自动下载并安装更新`
- Default: on
- Behavior: when off, background checks skip all network and updater work.

Show read-only update information in the same area:

- current app version
- last checked time
- current update status

First-version status values:

- `idle`
- `checking`
- `upToDate`
- `downloading`
- `installing`
- `readyToRestart`
- `disabled`
- `error`

Only `readyToRestart` needs a visible low-interruption prompt outside Settings. Periodic background failures should not show popups. Failures can appear in Settings as status text.

This feature is design-visible because it adds a Global settings row and status text. If implementation changes the Settings layout, update `AUI/PUI.pen` first through Pencil MCP and keep the React UI mapped to the design.

## Release Packaging

Add a local release script, for example `scripts/release-updater.mjs`. It prepares a directory that can be uploaded to the CDN. It does not upload files and does not store server credentials.

The script should:

1. Verify `app/package.json`, `app/src-tauri/Cargo.toml`, and `app/src-tauri/tauri.conf.json` versions match.
2. Require `TAURI_SIGNING_PRIVATE_KEY`; fail clearly if missing.
3. Run the Tauri release build for the current platform.
4. Verify updater artifacts and `.sig` files exist.
5. Build a static manifest for the `stable` channel.
6. Copy platform artifacts into a CDN-ready directory.
7. Write a short upload README into the output directory.

Suggested output structure:

```text
release-dist/
└── stable/
    ├── latest.json
    ├── darwin-aarch64/
    │   └── 桌宠番茄钟.app.tar.gz
    └── windows-x86_64/
        └── 桌宠番茄钟_0.1.1_x64-setup.exe
```

Suggested CDN URLs:

```text
https://updates.example.com/cpa/stable/latest.json
https://updates.example.com/cpa/stable/darwin-aarch64/桌宠番茄钟.app.tar.gz
https://updates.example.com/cpa/stable/windows-x86_64/桌宠番茄钟_0.1.1_x64-setup.exe
```

The concrete CDN host should be a config constant or environment-derived build value, not scattered through the codebase. The private signing key must never be committed. Losing the private key means already-installed users cannot trust future updates signed by a different key.

macOS and Windows packages should both be supported in the manifest. A macOS-only implementation is not enough for the product target. If implementation cannot build Windows artifacts on macOS, the release script should make that limitation explicit and document the matching Windows run.

## Static Manifest Shape

Use Tauri 2's supported static update JSON shape. The manifest must include:

- latest version
- release notes/body when available
- publication date when available
- platform-specific artifact URLs
- platform-specific signatures

The app should not parse the manifest itself for installation. It should let the updater plugin read, verify, download, and install the package.

## Error Handling

- Network failure, CDN 404, timeout, or malformed JSON: set `error`, keep running, retry on the next scheduled check.
- Signature verification failure: do not install. Treat as high-risk and show `更新包验证失败` in Settings.
- Download interruption: set `error`, retry on the next scheduled check.
- Install failure: set `error`, keep the current app running.
- User disables automatic updates: skip future checks. If an update is already `readyToRestart`, keep that state because the package is already installed.
- No update available: set `upToDate` and update last checked time.

The update service should avoid overlapping checks. If a check/download/install is already in progress, a later timer tick exits early.

## Security And Permissions

Keep the existing security posture:

- Do not disable or weaken CSP.
- Do not grant broad filesystem, shell, or window permissions.
- Do not add custom download/install commands unless the plugin APIs are insufficient.
- Store only the public updater key in the repo.
- Keep the private signing key in the release environment.
- Use HTTPS CDN URLs.

The update package signature is the trust anchor. CDN compromise should not be enough to make the app install a tampered package.

## Testing Strategy

Frontend tests:

- default setting enables automatic updates.
- disabling automatic updates skips check/download/install.
- successful update moves through `checking` to `downloading` to `installing` to `readyToRestart`.
- no update moves to `upToDate`.
- check/download/install errors move to `error` without throwing into React.
- an in-progress update ignores overlapping timer ticks.

Configuration tests:

- `tauri.conf.json` includes updater endpoints, public key placeholder/value, and `bundle.createUpdaterArtifacts`.
- `capabilities/default.json` includes only the updater/process permissions needed for this feature.
- package, Cargo, and Tauri config versions stay aligned.

Release script tests or dry-run checks:

- missing signing key fails.
- mismatched versions fail.
- missing updater artifact or signature fails.
- generated `latest.json` contains stable channel metadata and platform entries.
- generated CDN directory uses the expected structure.

Manual acceptance:

1. Build and install version `0.1.0`.
2. Serve a local static update directory that advertises version `0.1.1`.
3. Launch `0.1.0`, wait for the delayed check, and confirm no intrusive UI appears during download/install.
4. Confirm the app reaches `readyToRestart`.
5. Click the restart action and confirm the app relaunches into `0.1.1`.
6. Repeat on Windows before claiming Windows support.

## Out Of Scope

- Automatic CDN upload.
- GitHub Actions release automation.
- Beta UI or user-selectable channels.
- Gray rollout percentages.
- Forced updates.
- Rollback UI.
- Delta updates.
- Automatic restart.
- Custom updater implementation outside Tauri updater.

## References

- Tauri updater plugin documentation: https://v2.tauri.app/zh-cn/plugin/updater/
- Tauri updater JavaScript API: https://v2.tauri.app/zh-cn/reference/javascript/updater/
