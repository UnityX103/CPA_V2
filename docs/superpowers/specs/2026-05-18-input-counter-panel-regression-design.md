# Input Counter Panel Regression Fix Design

## Problem

The input counter feature already has the correct visual result, but the current behavior regresses in three places:

- Toggling the global key counter setting is noticeably slow.
- After enabling the setting, adding and capturing a key binding does not behave reliably.
- The independent input counter window does not appear reliably when there is a real key to monitor.

## Root Cause Direction

The main window owns the authoritative binding-key store. Settings and input-counter windows are mirrors. High-frequency key presses mutate `entries[].pressCount`; the current bridge mirrors the full snapshot to every mirror window on each mutation, including large active-app icon data. This makes key events and setting toggles heavier than needed.

The input-counter window controller also treats the global setting alone as the visibility condition. The desired condition is narrower: the independent input counter window should be visible only when the global setting is enabled and at least one enabled entry has a captured key code.

## Design

Use the main window as the only source of truth for binding keys. Settings-window actions continue to dispatch to the main window, but the mirrored state should update through snapshots without local optimistic mutation.

Reduce high-frequency bridge cost by splitting the active-app snapshot into lightweight metadata plus optional icon data. Regular store-change snapshots should include active app name/title/bundle id, but omit `icon_data_url` unless the active-app identity changes or a mirror requests an initial snapshot. This keeps key-count updates cheap while preserving icon rendering.

Drive the independent input counter window from `hasVisibleInputCounterPanel = panelEnabled && entries.some(entry.enabled && entry.keyCode >= 0)`. When false, hide the native window. When true, show it and resize it to the number of bound enabled entries.

Key capture must remain independent of the input counter window: adding an entry immediately sets `capturingId`, and the next `key-pressed` event completes the binding even while the panel window is hidden. Once the entry becomes bound, the visibility condition turns true and the panel shows.

## Testing

Add regression coverage for:

- No show command when the global setting is enabled but no key is bound.
- Show command when a key becomes bound.
- Hide command when the global setting turns off or the only bound entry is disabled/removed.
- Panel component returns null when there is no visible bound entry.
- Settings-window dispatch still reaches the main binding-key store for `addEntry`, `beginCapture`, and `setPanelEnabled`.
- Bridge host can send lightweight snapshots without repeatedly including `icon_data_url` during binding-key count updates.

## Out Of Scope

This fix does not change the Pencil design, the existing pixel layout, or Windows native key-counter implementation. Windows native active-app and global-key hooks remain a separate platform follow-up.
