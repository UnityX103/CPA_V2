# Check-in System Lifecycle Design

**Date**: 2026-06-16
**Status**: Approved by user default for Superpowers gates
**Supersedes**: the soft-disable behavior in `2026-05-23-checkin-global-toggle-design.md`

## Context

The global `打卡系统` switch currently behaves like a usage gate: it prevents normal opens and Pomodoro writes, but the check-in subsystem still exists in memory. Recent work also made `today-checkin` visible during native setup so the panel appears without waiting for a Pomodoro session.

The requested behavior is stricter. The global switch controls the lifecycle of the whole check-in system. Turning it off must unload all check-in UI. Turning it on must initialize the system again. The plan-panel switch remains a narrower visibility option for the today panel while the check-in system is active.

## Goals

- Treat `settings.checkinEnabled` as the authoritative check-in subsystem lifecycle flag.
- When `checkinEnabled` is `false`, no check-in UI components should be mounted or visible:
  - `today-checkin` renders no `TodayCheckinPanel`.
  - `checkin-editor` renders no `CheckinPlanEditorPanel`.
  - native `today-checkin` and `checkin-editor` windows are hidden.
  - normal app flows cannot open or raise check-in windows.
- When `checkinEnabled` becomes `true`, the check-in subsystem reinitializes from persisted/local or cloud snapshot data and then mounts its UI again.
- Preserve user data by default: plans and historical records are not deleted when disabling the system.
- Keep Pomodoro completion behavior: a natural focus timer end records check-in only when the subsystem is enabled, and raises the already-mounted today panel instead of creating an editor.

## Non-Goals

- Do not delete plan templates or daily records on disable.
- Do not add a second confirmation dialog.
- Do not change the plan template schema.
- Do not alter unrelated settings, Pomodoro, network, binding-key, or update lifecycles.

## Recommended Approach

Use `checkinEnabled` as a mount gate at every check-in UI boundary and as a lifecycle trigger in the main app.

The main window stays authoritative. It owns the real check-in store, persists data, and broadcasts snapshots. Mirror windows still receive bridge snapshots, but they render check-in panels only when both the bridge is ready and `checkinEnabled` is true.

Native windows should be created hidden during setup. The main React lifecycle opens `today-checkin` after local hydration if `checkinEnabled && planPanelEnabled`. This replaces startup-visible native creation, because disabled startup must not show check-in UI before settings hydration.

When the user disables `打卡系统`, the main controller immediately closes both check-in windows. The React roots in those windows also unmount their panel components by returning `null` while disabled, so hidden stale windows do not keep interactive UI alive.

When the user enables `打卡系统`, the controller opens the today panel if the plan-panel option is also enabled. The check-in store is re-applied from the current persisted snapshot source during startup; for runtime re-enable, existing in-memory plan and records are reused as the current initialized state. This is the default data-preserving interpretation of "reinitialize": lifecycle and UI are rebuilt, user data is not reset.

## Data Flow

Startup:

1. Tauri creates `today-checkin` and `checkin-editor` as hidden mirror windows.
2. The main window loads preferences/cloud archive and hydrates stores.
3. `localHydrated` becomes true.
4. `useCheckinWindowController` sees `checkinEnabled`.
5. If enabled and `planPanelEnabled`, it opens `today-checkin`; otherwise it closes check-in windows.

Settings toggle off:

1. Settings window dispatches `settings/setCheckinEnabled(false)` to the main window.
2. Main settings store persists the value.
3. `useCheckinWindowController` calls `close_checkin_windows`.
4. Bridge snapshots tell mirror windows `checkinEnabled=false`.
5. `TodayCheckinApp` and `CheckinEditorApp` render no check-in panel components.

Settings toggle on:

1. Settings window dispatches `settings/setCheckinEnabled(true)`.
2. Main settings store persists the value.
3. Bridge snapshots tell mirror windows `checkinEnabled=true`.
4. `useCheckinWindowController` opens `today-checkin` if `planPanelEnabled=true`.
5. Mirror windows remount their panel components after bridge readiness.

Pomodoro focus end:

1. The effect checks `checkinEnabled`.
2. If disabled, it does nothing.
3. If enabled, it applies focus completion to the check-in store.
4. If the end is a natural timer break, it calls `raise_today_checkin_window`.

## UI Behavior

- `打卡系统` off means all check-in UI disappears.
- `打卡系统` on and `计划面板` on means the today panel is visible.
- `打卡系统` on and `计划面板` off means the editor can still be opened from allowed flows, but the today panel stays hidden.
- The editor cannot be opened while `打卡系统` is off.
- A hidden mirror window may still exist as a native shell implementation detail, but it must not mount or show check-in UI while disabled.

## Testing

- App startup opens `today-checkin` only after hydration when `checkinEnabled && planPanelEnabled`.
- Native setup creates `today-checkin` hidden, not visible.
- Disabling `checkinEnabled` closes both check-in windows.
- Re-enabling `checkinEnabled` opens the today panel when `planPanelEnabled` is true.
- `TodayCheckinApp` renders no panel when bridge is ready but `checkinEnabled=false`.
- `CheckinEditorApp` renders no panel when bridge is ready but `checkinEnabled=false`.
- Pomodoro natural focus end calls `raise_today_checkin_window` only when `checkinEnabled=true`.
- Open/raise helpers no-op when `checkinEnabled=false`.
- Full test suite and build must pass.

## Self-Review

- Placeholder scan: no TBDs or TODOs remain.
- Internal consistency: the global switch owns subsystem lifecycle; plan-panel switch owns today-panel visibility only inside an enabled subsystem.
- Scope check: this is one focused lifecycle correction across App, check-in windows, mirror apps, native setup, and tests.
- Ambiguity check: "reinitialize" is explicitly data-preserving; UI and runtime mount state reset, plans and records remain.
