# Check-in Global Toggle Design

**Date**: 2026-05-23
**Status**: Approved by delegated defaults
**Design source**: `AUI/PUI.pen` reusable `Pdj9C` (`Global Settings Panel`), row `gspDailyPlan`

## Context

The check-in system already exists as independent Tauri windows backed by `app/src/domain/checkin.ts`. The main window owns the real check-in store, mirror windows render `TodayCheckinPanel` and `CheckinPlanEditorPanel`, and check-in data is included in local and cloud preference snapshots.

The Pencil global settings panel already contains a row named `gspDailyPlan`, but the React settings UI does not expose that control. The requested feature is to import that global settings control into the app and use it to control whether the check-in system is active.

## Goals

- Add a global settings switch for the check-in system.
- Keep the visual source of truth in `AUI/PUI.pen` by using the existing global settings row and labelling it clearly as `打卡系统`.
- Persist the setting locally and in the existing user-preferences/cloud snapshot.
- Mirror the setting through the existing bridge so the settings window and check-in windows stay consistent.
- When disabled, stop normal check-in usage without deleting the user's plan or historical records.
- Preserve current behavior by default: the check-in system is enabled unless the user turns it off.

## Non-Goals

- Do not delete check-in data when the switch is disabled.
- Do not add a new settings tab or a modal.
- Do not change the check-in plan editor data model.
- Do not change the WebSocket room protocol.
- Do not add native Rust commands; this is a frontend/domain preference.

## Recommended Architecture

Use the existing `settings` domain as the source of truth for the new preference:

- Add `checkinEnabled: boolean` to `SettingsState`.
- Default it to `true`.
- Add `setCheckinEnabled(enabled: boolean)` beside the existing `setAutostartEnabled`.
- Persist it through `settingsPersistence.ts` for legacy local settings.
- Include it in `userPreferences.ts` so the local archive and cloud account data save the same value as the rest of global settings.
- Include it in `BridgeSnapshot.settings` and dispatch payloads so mirror windows receive and update it through the existing bridge.

The check-in store remains responsible for plans and records. It should not own the global enable switch. This keeps "whether the module is available" in global settings and "what the module contains" in the check-in domain.

## Product Behavior

Default state: enabled.

When enabled:

- `today-checkin` opens on startup as it does today.
- Focus Pomodoro completion opens the today check-in panel after the timer finishes.
- Focus Pomodoro completion increments effective `pomodoroFocus` check-in items.
- The today check-in panel renders the daily state and can open the editor.

When disabled:

- `today-checkin` does not auto-open on startup.
- Focus Pomodoro completion does not auto-open the today check-in panel.
- Focus Pomodoro completion does not increment check-in records.
- The today check-in and editor windows should not be opened by normal app flows.
- Existing weekly plans and daily records remain stored and are shown again if the switch is re-enabled.

If a check-in window is already open when the user disables the setting, it may stay open until the next normal close or reload in this pass. The important invariant is that disabled check-in no longer receives automatic opens or automatic Pomodoro writes.

## Pencil Requirements

Update `AUI/PUI.pen` only through Pencil MCP:

- Reuse `Pdj9C/gspDailyPlan`.
- Rename the row label from `每日计划` to `打卡系统`.
- Keep the row between `开机自启动` and `自动下载并安装更新`.
- Keep the row as a toggle using the existing `NGo9f` switch component.

No new component is required because the visual pattern already exists.

## Data Flow

Main window startup:

1. Load existing user preferences or legacy settings.
2. Hydrate `settings.checkinEnabled`, defaulting to `true` when older snapshots do not contain the field.
3. Mount the check-in window controller, but let the controller open `today-checkin` only when `checkinEnabled` is true.

Settings window:

1. The global tab reads `settings.checkinEnabled`.
2. The toggle dispatches `settings/setCheckinEnabled` when rendered as a mirror window.
3. The main window applies the action, persists settings, and emits a bridge snapshot back to mirror windows.

Pomodoro integration:

1. The focus-end effect checks `settings.checkinEnabled`.
2. If enabled, it applies Pomodoro check-in completion and opens the today panel.
3. If disabled, it does neither.

## Error Handling

- Malformed or older persisted settings should not block startup; `checkinEnabled` falls back to `true`.
- A failed settings save should keep the in-memory setting, matching the existing settings persistence behavior.
- If a mirror dispatch fails in a non-Tauri test environment, existing dispatch swallow behavior may remain.

## Testing

Domain tests:

- Settings default `checkinEnabled` is `true`.
- Hydration accepts persisted `checkinEnabled`.
- Missing persisted `checkinEnabled` defaults to `true`.
- Main-window `setCheckinEnabled` updates state and persists.
- Settings-window `setCheckinEnabled` dispatches instead of mutating local source state.
- `settingsSig` includes `checkinEnabled`.

Persistence tests:

- `settingsPersistence` loads and saves `checkinEnabled`.
- `userPreferences` builds, hydrates, and normalizes `settings.checkinEnabled`.

Bridge tests:

- `BridgeSnapshot.settings` includes `checkinEnabled`.
- Bridge client applies mirrored `checkinEnabled`.
- Bridge host routes `setCheckinEnabled` to the authoritative settings store.

UI tests:

- The global tab renders a `打卡系统` toggle.
- Clicking the toggle calls `setCheckinEnabled(false)` or dispatches the equivalent mirror action.

Integration tests:

- With `checkinEnabled` true, the existing focus-end Pomodoro behavior still increments check-in and opens the today panel.
- With `checkinEnabled` false, focus-end Pomodoro behavior does not increment check-in and does not open the today panel.

Manual verification:

- Compare the global settings row against `AUI/PUI.pen`.
- Launch with `./start.sh`, open Settings, confirm the global tab shows `打卡系统`.
- Toggle it off, complete a focus session, and confirm the today check-in panel does not open and the record does not change.
- Toggle it on, complete a focus session, and confirm the current behavior returns.

## Self-Review

- Placeholder scan: no placeholder requirements remain.
- Internal consistency: the setting lives in global settings; check-in data remains in the check-in domain.
- Scope check: this is one focused implementation pass covering Pencil, settings state, persistence, bridge, UI, and Pomodoro gating.
- Ambiguity check: "control check-in system usage" means disable normal opens and automatic writes while preserving existing data.
