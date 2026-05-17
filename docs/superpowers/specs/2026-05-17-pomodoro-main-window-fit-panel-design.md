# Pomodoro Main Window Fit-Panel Design

**Date:** 2026-05-17
**Status:** Draft, awaiting user review
**Scope:** Main Pomodoro window size, main-window layout, and removal of obsolete main-window hit-test passthrough
**Platforms:** macOS + Windows
**Supersedes:** Main-window portions of `2026-05-15-overlay-hit-passthrough-design.md`

## 1. Problem

The visible Pomodoro panel is small (`233 x 155`), but the Tauri main window is still configured as a large transparent rectangle (`1100 x 680`). Even though most of that window is visually transparent, it is still a real always-on-top OS window and can block interaction with other apps and the settings panel behind it.

An earlier design solved the large transparent rectangle by registering frontend hit regions and using native passthrough hit testing. The user now wants a simpler model: every visible app panel should live in a window that is the same size as that panel. Under that model, transparent-region hit testing is no longer needed for the Pomodoro main window.

## 2. Goals

- Make the main window's real OS hit area match the Pomodoro panel's visual footprint.
- Keep the main window responsible only for the Pomodoro panel.
- Remove the old main-window transparent-area hit-region / passthrough mechanism.
- Ensure the Pomodoro panel still supports dragging, settings opening, and the HApJ0 pin button behavior.
- Keep settings-window first-click and focus-restoration fixes intact.

## 3. Non-Goals

- Do not implement or redesign the RemoteRoster window. RemoteRoster is a separate small window and should not be mounted in the main window.
- Do not solve future pet free-movement layout in this change.
- Do not use whole-window mouse-ignore toggles such as `set_ignore_cursor_events` or `WS_EX_TRANSPARENT`.
- Do not change the WebSocket room protocol or networking behavior.
- Do not resize or restyle the settings panel.

## 4. Architecture

The main window becomes a fixed-size Pomodoro panel host:

- `PomodoroPanel` remains `233 x 155`.
- `.app-root` keeps `8px` padding around the panel.
- The main Tauri window uses an inner size of `249 x 171`.
- The main Tauri window is not resizable.
- The React root and `.app-root` no longer force `100vw x 100vh` for the main window layout.
- `App.tsx` renders only `PomodoroPanel` in the main window.
- `RemoteRoster` is removed from the main-window tree.

The hit area now comes from the OS window bounds, not a custom hit-region registry. This makes the behavior easier to reason about: if the user can see the Pomodoro panel window, that rectangle can receive input; anything outside the window belongs to the app underneath.

## 5. Components and File-Level Changes

### Frontend

- `app/src/App.tsx`
  - Remove `RemoteRoster` from the main-window render tree.
  - Keep the domain listeners that are still needed by the Pomodoro panel and app state.

- `app/src/styles/global.css`
  - Remove the main-window layout's forced full-viewport sizing.
  - Make `.app-root` fit its content with `8px` padding.
  - Preserve transparent background and hidden overflow.

- `app/src/ui/PomodoroPanel.tsx`
  - Remove `useHitRegion('pomodoro-panel')`.
  - Keep drag handling through `getCurrentWindow().startDragging()`.
  - Keep HApJ0 pin behavior through `set_main_window_pinned`.

- `app/src/ui/RemoteRoster.tsx`
  - Remove `useHitRegion('remote-roster')`.
  - Leave the component available for its separate window path.

- `app/src/main.tsx`
  - Remove `clearHitRegions()` on main-window boot.

- `app/src/domain/passthrough.ts` and `app/src/domain/passthrough.test.tsx`
  - Delete them if no remaining frontend code imports them.

### Tauri Config

- `app/src-tauri/tauri.conf.json`
  - Set main window `width` and `height` to `249` and `171`.
  - Set main window `minWidth` and `minHeight` to the same values.
  - Set main window `resizable` to `false`.
  - Keep `transparent: true`, `decorations: false`, `shadow: false`, and `titleBarStyle: "Transparent"`.

### Rust Native Layer

The current `passthrough` module mixes obsolete main-window passthrough with still-useful settings-window helpers. Implementation should separate these concerns before deletion:

- Delete the main-window hit-region store and commands:
  - `Rect`
  - `HitRegionStore`
  - `register_hit_region`
  - `unregister_hit_region`
  - `clear_hit_regions`
  - main-window `install`
  - main-window `uninstall`

- Remove `set_click_through`, because it is an unused whole-window mouse-ignore command and is no longer part of the intended design.

- Remove platform code that only exists for main-window transparent passthrough:
  - macOS `hitTest:` passthrough subclass behavior
  - Windows `WM_NCHITTEST -> HTTRANSPARENT` passthrough behavior

- Preserve settings-window support:
  - `compute_centered_origin`
  - `install_first_mouse_only`
  - `install_focus_restorer`
  - `post_did_move_notification_for_testing` on macOS

The preserved settings-window helpers may stay in a renamed module, for example `window_helpers`, or remain in `passthrough` temporarily with comments updated. The important requirement is that no main-window transparent-area passthrough behavior remains.

## 6. Data Flow

The main window no longer sends layout rectangles from the DOM to Rust. There is no hit-region registration lifecycle.

The remaining runtime flow is:

1. Tauri creates a transparent, decorationless, fixed-size main window.
2. React renders `.app-root` with `8px` padding and the `PomodoroPanel`.
3. The user interacts with the visible panel only.
4. The HApJ0 pin button calls `set_main_window_pinned`.
5. The settings button opens the existing settings window.

## 7. Error Handling

- If `set_main_window_pinned` fails, keep the existing frontend console error behavior.
- If the settings window cannot be shown, preserve the current `open_settings_window` error behavior.
- The app should not fail startup because the obsolete passthrough module was removed.
- Removing hit-region commands must not leave dangling frontend `invoke` calls; tests should catch this through import/build failures.

## 8. Testing

### Automated

- `cd app && npm test`
- `cd app && npm run build`
- `cd app/src-tauri && cargo test`
- `cd app/src-tauri && cargo check`

Expected coverage changes:

- Remove passthrough frontend unit tests with the deleted module.
- Remove or rewrite Rust tests that only cover `HitRegionStore`.
- Keep tests for `compute_centered_origin` and settings-window behavior.
- Add or update a frontend test that `App` renders the Pomodoro panel without rendering `RemoteRoster`.

### Manual

Run the Tauri app and verify:

1. The main window's inspectable root/window area is approximately the same as the Pomodoro panel host, not `1100 x 680`.
2. Clicking and dragging outside the Pomodoro window interacts with the app underneath.
3. The Pomodoro header still drags the window.
4. HApJ0 still toggles always-on-top.
5. The settings button still opens the settings panel.
6. The settings panel remains interactive when it overlaps the Pomodoro window.

## 9. Migration Notes

The old passthrough design was correct for a large overlay window. This design intentionally changes the window model, so passthrough becomes unnecessary complexity. The implementation should remove the old mechanism instead of keeping it as a defensive layer, because all app windows are expected to match their visible panel bounds.

If a future feature needs a large canvas again, it should introduce a new design rather than silently restoring the old passthrough mechanism.
