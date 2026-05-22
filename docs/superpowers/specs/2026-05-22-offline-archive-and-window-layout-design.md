# Offline Archive And Window Layout Persistence Design

**Date**: 2026-05-22
**Status**: Pending user review
**Scope**: Keep Pomodoro/settings/check-in archive data available offline, prefer restored account cloud archives when login can be restored, and persist every local window's position and size on this machine only.

## Goal

CPA_V2 should feel durable whether the user is logged in or not.

When a user has logged in before, startup should first try to restore that account session. If session restore succeeds, the app should pull the cloud archive and use it as the latest account-backed archive. If session restore fails, the app must continue with the local archive instead of blocking startup or losing edits.

Window position and size are not archive data. They should be saved only on the current machine, per Tauri window label, because monitor layout, DPI, and user placement are machine-specific.

## Current Context

The app already has most of the pieces:

- `accountPersistence.ts` stores a saved account token and username in `account.json`.
- `network.ts::restoreAccountSession` sends `auth_session` when a saved token exists and clears account state on invalid sessions.
- `userPreferencesPersistence.ts` stores the unified local user preference archive in `user-preferences.json`.
- `cloudAccountSync.ts` syncs cloud data only when `accountStatus === 'loggedIn'`.
- `App.tsx` currently hydrates local preferences first, then calls `restoreAccountSession`.
- `scaled_window.rs` resizes windows and clamps their current origin to the monitor, but it does not persist or restore layout.
- `open_settings_window_impl`, `useScaledWindowSize({ center: true })`, and `useCheckinEditorWindowSize` can re-center settings/check-in editor windows even after the user moved them.

This design keeps the main window as the authoritative domain owner. Other windows continue mirroring domain state through the existing bridge.

## Durable Archive Data

Archive data is user-owned product state. It is saved locally and, when logged in, mirrored to cloud for backup and multi-device sync.

Archive data includes:

- Pomodoro settings: focus duration, break duration, total rounds, auto-start break, end-action mode, built-in video id, and custom video path.
- Global settings: committed UI scale and autostart intent.
- Check-in data: weekly plan, carry-forward flag, item definitions, icons, per-use metadata, and daily records.
- App update preference: automatic update enablement.
- Online preference: auto-connect flag and player display name.
- Binding-key preferences: panel enabled, binding definitions, enabled flags, labels, bound keyboard/mouse inputs, and selected synced binding id.

Archive data excludes:

- Account password and transient account errors.
- Current room membership, remote players, room status, and websocket lifecycle state.
- Pomodoro runtime state such as current phase, running state, remaining seconds, current round, and last end event.
- Input press counts, capture-in-progress id, listener status, accessibility diagnostics, and active app metadata.
- Window position, window size, visible/hidden state, focus, pinned runtime state, and monitor identity.

## Startup Data Flow

Startup should prefer account restoration when there is a saved session, but it must remain fast and offline-safe.

1. Load the local archive snapshot from `user-preferences.json` and keep it available as a fallback.
2. Ask `accountPersistence` whether a saved account session exists.
3. If no saved account session exists, hydrate from the local archive immediately and continue as guest.
4. If a saved account session exists, try `restoreAccountSession` with a bounded startup wait. The app must not wait indefinitely for websocket connection, auth, or cloud pull.
5. If session restore fails or times out because the token is invalid, the server is unreachable, or websocket setup fails, hydrate from the local archive and mark account/cloud status as guest/offline/error as appropriate.
6. If session restore succeeds, request cloud user data.
7. If cloud data exists, normalize it, hydrate stores from it, and save the normalized result back to the local archive.
8. If cloud data does not exist, hydrate from the local archive and upload that archive to initialize cloud storage.
9. After the final archive source is chosen, start normal local archive subscriptions and automatic update checks.

The local archive is always the fallback that lets the app run. The cloud archive is the restored account source when login succeeds, and otherwise a backup/sync target.

## Change Data Flow

After hydration:

1. Main-window store subscriptions observe only durable archive fields.
2. Any durable change writes the unified local archive with a short debounce.
3. If the user is logged in, the same change schedules a cloud save with the existing cloud debounce.
4. When a cloud pull applies a cloud archive, the app writes the applied cloud archive locally so future offline launches see the same state.
5. If cloud save fails, local save still succeeds and the cloud state reports offline/error.

Pomodoro settings and check-in plan edits should not require account login. Logging in later should upload or merge the local archive according to the existing cloud conflict behavior.

## Window Layout Data

Window layout is per-machine data, stored separately from the user archive.

Add a local-only persisted layout store, backed by Tauri store:

```ts
interface WindowLayoutSnapshot {
    schemaVersion: 1;
    windows: Record<string, {
        x: number;
        y: number;
        width: number;
        height: number;
    }>;
}
```

Supported labels:

- `main`
- `settings`
- `today-checkin`
- `checkin-editor`
- `input-counter`

The layout file should not include account id, username, room code, monitor name, cloud timestamp, or any cloud-sync metadata.

## Window Layout Behavior

Each supported window follows the same rule:

1. On startup or hidden-window construction, load any saved layout for the label.
2. Before showing a hidden window, apply the saved position and size if present.
3. If no saved layout exists, use the current default behavior:
   - `settings` centers on the main window's monitor.
   - `checkin-editor` centers through the scaled-window flow.
   - Other windows use their current default construction/open behavior.
4. After any user move or resize event, save the new logical position and logical size with a debounce.
5. When UI scale changes and the app resizes a scaled window, preserve the saved or current top-left position and clamp the resulting rectangle into the current monitor's visible area.
6. If saved layout is malformed, non-finite, too small, or completely off-screen, ignore the bad fields and fall back to default placement.

`settings` and `checkin-editor` must not re-center every time they open once a saved layout exists. Resizable windows should restore both size and position; non-resizable windows can still store size to keep the snapshot uniform, but their restored size is clamped to the current expected scaled dimensions.

## Architecture

Use two explicit persistence boundaries:

- `userPreferencesPersistence`: account archive data, local-first and cloud-syncable.
- `windowLayoutPersistence`: machine layout data, local-only and never cloud-syncable.

The Rust side is the best place to observe reliable window movement and resizing because it already owns Tauri window construction and scaled-window resizing. It should expose a small platform-neutral command/event surface, not macOS-only or Windows-only code.

The frontend can still decide window labels and expected scaled sizes, but it should not need to manually save drag positions from each UI component. Native `WindowEvent::Moved` and `WindowEvent::Resized` handlers should centralize layout capture for all windows.

## Error Handling

- If account session restore fails, clear invalid saved sessions only for explicit invalid-session errors; connection errors should keep the saved session for a future launch.
- If account session restore or cloud pull does not complete within the startup wait budget, continue with local archive and keep the saved session for a later retry.
- If cloud data is malformed, reject the malformed sections and fall back to local archive defaults for those sections rather than crashing startup.
- If local archive load fails, use app defaults and continue.
- If local archive save fails, keep in-memory changes and log a warning.
- If window layout load/save fails, keep the app usable and log a warning.
- If a saved window rectangle is outside all monitors, clamp it to the current monitor when possible; otherwise use default placement.

## Testing

Add or update tests for:

- Startup with no saved account session hydrates from local archive.
- Startup with saved account session and successful cloud pull applies cloud archive and writes it locally.
- Startup with saved account session but invalid token falls back to local archive and clears the saved account session.
- Startup with saved account session but connection failure falls back to local archive without deleting the saved account session.
- Logged-out Pomodoro settings, global settings, and check-in plan changes write to local archive.
- Logged-in changes write local archive first and schedule cloud save.
- Cloud pull updates the local archive after hydration.
- Window layout persistence validates good layouts and rejects malformed layouts.
- Settings and check-in editor windows do not re-center when saved layouts exist.
- Scaled-window resizing preserves top-left origin and clamps the rectangle to the monitor.
- Layout data is absent from `UserPreferencesSnapshot` and `CloudAccountData`.

## Manual Verification

1. Log out, change Pomodoro settings, global UI scale, and check-in plan, then restart. Confirm all settings restore from local archive.
2. Log in, change the same archive settings, restart with the server available, and confirm cloud archive is applied and written locally.
3. Restart with a saved account session while the server is unavailable. Confirm the app opens with the local archive and does not lose the saved session.
4. Move and resize the main/settings/check-in editor windows, restart, and confirm positions and sizes restore.
5. Change UI scale after moving windows. Confirm the windows resize but stay near the user's chosen position and remain visible.
6. Use a second machine or profile with the same account. Confirm archive data syncs, while window positions and sizes do not.
