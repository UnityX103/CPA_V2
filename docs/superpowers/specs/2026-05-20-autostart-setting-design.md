# Autostart Setting Design

**Date**: 2026-05-20
**Scope**: Add an opt-in `开机自启动` setting to CPA_V2, update the Pencil source of truth first, then import the setting into the Tauri app with Windows and macOS support. The default is off.

## Goal

Users can choose whether CPA_V2 launches automatically after OS login. Fresh installs and malformed stored settings must default to `off`.

The setting belongs in `全局设置`, because it controls app-level desktop behavior rather than Pomodoro, network, pet, or key counter behavior.

## Approaches Considered

### Recommended: Tauri Autostart Plugin

Use the official Tauri 2 autostart plugin and expose it through the existing settings store, bridge, and global settings UI.

This is the smallest cross-platform implementation. The official plugin supports desktop startup registration, provides JavaScript APIs for `enable`, `disable`, and `isEnabled`, and documents the required capability permissions. It avoids hand-written Windows registry logic and hand-written macOS LaunchAgent files.

### Native Commands Per Platform

Add `src-tauri/src/autostart/{macos,windows}.rs` and expose custom commands such as `set_autostart_enabled`.

This would preserve the repo's native-command pattern, but it creates unnecessary platform-specific maintenance for a solved Tauri feature. It also increases the risk of Windows installer/path edge cases.

### Settings-Only Placeholder

Add the UI and persisted field, but defer OS registration.

This would be lower risk for UI work, but it would not satisfy the feature request. The user asked for the feature to be imported into the project and compatible with Windows.

## Pencil Design

Modify `AUI/PUI.pen` before frontend code.

Target node:

- `Pdj9C` — `Global Settings Panel`

Add a new card after `gspActiveFileTitle` and before `gspAutoUpdate`.

Card details:

- Name: `gspAutostart`
- Shape: same compact toggle-card pattern as `gspActiveFileTitle`
- Fill: `#F6F7F8`
- Corner radius: `16`
- Padding: `16`
- Width: `fill_container`
- Layout: horizontal
- Alignment: center
- Justify: `space_between`
- Left label: `开机自启动`
- Label style: match the other global setting labels
- Right control: instance of `Toggle Switch` (`NGo9f`)
- Visual state: off by default

The existing `Unified Settings Panel` (`vnYnS`) already holds the global panel as a disabled instance inside `contentArea`; no new settings window concept is needed.

## Frontend State

Extend `app/src/domain/settings.ts`:

- Add `autostartEnabled: boolean` to `SettingsState`.
- Add `setAutostartEnabled(enabled: boolean): Promise<void> | void`.
- Default both main-window and settings-window stores to `false`.
- Hydrate missing or malformed persisted values as `false`.

Settings-window mode remains a mirror. Its setter dispatches to main through the existing bridge. Main-window mode is the authority: it updates state, persists settings, and applies the OS autostart registration.

## Persistence

Extend `app/src/domain/settingsPersistence.ts`:

- Add `autostartEnabled: boolean` to `PersistedSettings`.
- Keep the current persisted version at `v: 1` if possible by treating the new field as optional when reading.
- Save the field on all settings writes.
- Default omitted values to `false`.

Existing stored settings containing only `uiScale` and `showActiveAppWindowTitle` remain valid.

## Autostart Integration

Add the official Tauri 2 autostart plugin:

- JavaScript package: `@tauri-apps/plugin-autostart`
- Rust crate: `tauri-plugin-autostart`
- Rust initialization in `app/src-tauri/src/lib.rs`, using `MacosLauncher::LaunchAgent` for macOS.
- Capability permissions in `app/src-tauri/capabilities/default.json`:
  - `autostart:allow-enable`
  - `autostart:allow-disable`
  - `autostart:allow-is-enabled`

Create a small frontend domain helper, `app/src/domain/autostart.ts`, that wraps plugin calls:

- `readAutostartEnabled(): Promise<boolean>`
- `applyAutostartEnabled(enabled: boolean): Promise<boolean>`

The helper catches plugin failures, logs a warning, and returns the best available state. This keeps plugin-specific behavior out of `SettingsPanel.tsx`.

Startup behavior:

1. The main window loads persisted settings.
2. Main asks the plugin for the real OS registration state.
3. The initial store value becomes the plugin state when available, otherwise the persisted value.
4. If the plugin state differs from the persisted value, persist the plugin state back into `settings.json`.

Toggle behavior:

1. The user changes `开机自启动` in global settings.
2. Settings-window mode dispatches to main.
3. Main calls `enable()` or `disable()`.
4. Main updates `autostartEnabled` to the confirmed plugin result.
5. Main persists the confirmed value.

If enabling or disabling fails, keep the store aligned to the confirmed plugin state and expose no new modal in this pass. The UI simply remains or returns to the last confirmed state.

## Bridge

Extend the existing settings bridge:

- Add `settings.autostartEnabled` to `BridgeSnapshot`.
- Add settings dispatch action `setAutostartEnabled`.
- Include the field in `settingsSig` so mirror windows receive updates.
- Hydrate the settings-window store from snapshots without local mutation.

No server protocol changes are needed. This is local app state only and must not be included in `RemoteState`.

## UI

Update `app/src/ui/SettingsPanel.tsx`:

- Render a new global settings card labeled `开机自启动`.
- Use the existing `Toggle` component.
- Bind it to `settings.autostartEnabled` and `settings.setAutostartEnabled`.

Update CSS only if the existing `card` and `card-row` classes cannot express the Pencil card. No new visual language is introduced.

## Error Handling

- Plugin unavailable in tests or non-Tauri environments: helper returns the provided fallback and logs a warning.
- Plugin query fails on app startup: hydrate from persisted value, leave default false for fresh installs.
- Plugin enable/disable fails after a user toggle: re-query if possible, update UI to the confirmed state, and persist that confirmed state.
- No Windows permission prompt is expected for this setting. Windows support is provided by the official plugin rather than a custom registry writer.

## Tests

Add or update unit tests:

- `settings.ts`: default `autostartEnabled=false`.
- `settings.ts`: hydration defaults missing `autostartEnabled` to false.
- `settings.ts`: main-store setter calls autostart helper, updates state, and saves confirmed state.
- `settings.ts`: settings-window setter dispatches instead of mutating local state.
- `settingsPersistence.ts`: reads old persisted settings without the new field.
- `settingsPersistence.ts`: saves and loads `autostartEnabled`.
- `bridge/protocol.test.ts`: accepts `setAutostartEnabled`.
- `bridge/host.test.ts`: snapshot, dispatch, and signature include `autostartEnabled`.
- `bridge/client.test.ts`: mirrors `autostartEnabled`.
- `SettingsPanel.test.tsx`: global tab renders `开机自启动` and toggles through the settings action.

Run:

- `cd app && npx vitest run src/domain/settings.test.ts src/domain/settingsPersistence.test.ts src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts src/ui/SettingsPanel.test.tsx`
- `cd app && npm test`
- `cd app && npm run build`
- `cd app/src-tauri && cargo check`

Manual verification:

- Open Settings.
- Enter `全局`.
- Confirm `开机自启动` is visible and off by default.
- Turn it on, close and reopen Settings, and confirm the switch stays on.
- Turn it off, close and reopen Settings, and confirm the switch stays off.
- On Windows, verify the app registers/unregisters startup through the plugin-backed setting rather than a macOS-only path.

## Non-Goals

- Do not add a confirmation dialog for this toggle.
- Do not add launch-minimized behavior in this pass.
- Do not alter updater startup behavior.
- Do not sync this setting to rooms or remote players.
- Do not change the app's default startup setting from off.

## References

- Tauri Autostart plugin: https://v2.tauri.app/plugin/autostart/
- Tauri JavaScript autostart API: https://v2.tauri.app/reference/javascript/autostart/
