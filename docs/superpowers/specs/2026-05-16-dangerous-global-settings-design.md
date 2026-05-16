# Dangerous Global Settings — Preview, Confirm, Persist

## Context

The Settings panel already has a Global tab (`Pdj9C`) with a scale slider (`gspScale` / `YwCv6`) and the shared confirm dialog design exists in Pencil as `ConfirmDialog` node `bfMCZ`. Today `uiScale` is a single value in `app/src/domain/settings.ts`; the settings window dispatches `settings/setUiScale` to the main window through the existing bridge, and the main window mirrors state back with `app:state`.

The requested behavior is broader than scale: every dangerous Global setting must use the same safety flow. A dangerous setting is one that can make the UI hard to recover from, such as extreme UI scale or future global display/window behavior changes.

## Goals

- Make the UI scale slider follow pointer movement continuously while dragging.
- Apply the target scale immediately as a preview to all app UI content.
- Show one blocking modal with a full-window mask whenever a dangerous Global setting is previewed.
- Revert to the previous committed value if the user does not apply within 5 seconds.
- Persist the new value only when the user explicitly clicks Apply.
- Reuse the same dangerous-setting mechanism for future Global dangerous operations.

## Non-Goals

- Do not resize Tauri windows when the scale changes. Scale affects content inside each window, like browser page zoom.
- Do not add multiple simultaneous dangerous dialogs. The mask blocks all Settings UI, so only one pending dangerous operation can exist at a time.
- Do not redesign the dialog. Reuse Pencil `bfMCZ` structure and existing tokens.
- Do not migrate unrelated settings to persistence in this pass unless needed for the scale flow.

## User Experience

When the user drags the Global tab scale slider:

1. The slider thumb follows the pointer continuously.
2. The app immediately previews the target scale across all windows.
3. A modal mask covers the Settings window and prevents all other Settings UI interaction.
4. The `bfMCZ` dialog appears with a danger-specific title/body and countdown text such as `剩余 5s 后自动还原`.
5. Clicking `应用` commits the preview and persists it locally.
6. Clicking `取消`, closing via cancel action, or letting the 5 second countdown expire restores the previous committed scale.

Main window content scales immediately but does not show a second modal. The confirmation UI belongs to the Settings window because that is where the dangerous action was initiated.

## State Model

Replace the single conceptual `uiScale` value with committed and preview state while preserving the public `uiScale` read surface as the effective value used by UI.

```ts
type DangerousSettingKind = 'uiScale';

interface DangerousChange {
  id: string;
  kind: DangerousSettingKind;
  previousValue: number;
  nextValue: number;
  expiresAt: number;
}

interface SettingsState {
  activeTab: SettingsTab;
  uiScale: number;          // effective preview value used by UI
  committedUiScale: number; // durable value
  dangerousChange: DangerousChange | null;
}
```

Actions:

- `previewDangerousUiScale(scale: number)`: clamp the scale, create or update the pending `uiScale` dangerous change, set `uiScale` to the preview value, and refresh the 5 second expiry.
- `applyDangerousChange(id: string)`: if the pending id matches, commit `uiScale` into `committedUiScale`, clear `dangerousChange`, and persist the committed settings.
- `revertDangerousChange(id: string)`: if the pending id matches, restore `uiScale` from `previousValue`, leave `committedUiScale` unchanged, and clear `dangerousChange`.
- `hydrateSettings(snapshot)`: initialize `committedUiScale` and `uiScale` from persisted local settings on the main window.

Keep `setUiScale(scale)` only as an internal immediate setter for hydration, test setup, and future non-dangerous programmatic changes. The Global scale slider must not call it. User-driven scale changes must go through `previewDangerousUiScale` followed by either `applyDangerousChange` or `revertDangerousChange`.

## Bridge Flow

The main window remains the source of truth.

Settings window:

- Slider drag calls `previewDangerousUiScale`.
- In settings-window mode, that action dispatches to main through `app:dispatch`.
- Apply/cancel buttons also dispatch to main by pending id.
- The settings window updates its mirrors from main snapshots, as today.

Main window:

- `applyDispatch` routes dangerous actions into the source `settings` store.
- `buildSnapshot` includes the effective `uiScale`, `committedUiScale`, and `dangerousChange`.
- Snapshot mirroring keeps the Settings dialog countdown, slider value, and preview scale aligned with main.

Keep `BRIDGE_VERSION = 1` for this change. Both webviews are loaded from the same app bundle, so there is no supported mixed-version bridge during normal runtime. Update the TypeScript snapshot and dispatch types plus tests together.

## Persistence

Use the already installed Tauri Store stack:

- Frontend dependency: `@tauri-apps/plugin-store`
- Rust plugin: `tauri-plugin-store`

Persistence belongs in a small domain helper, not inside `SettingsPanel.tsx`.

Recommended helper:

```ts
interface PersistedSettingsV1 {
  v: 1;
  uiScale: number;
}
```

Main-window startup:

1. Load persisted settings.
2. Clamp `uiScale` to `[MIN_SCALE, MAX_SCALE]`.
3. Set both `committedUiScale` and effective `uiScale` to that value.
4. If loading fails, keep defaults and log a warning.

Apply path:

1. Commit the preview in memory.
2. Persist `PersistedSettingsV1`.
3. If persistence fails, keep the in-memory committed value and expose a warning path later. Do not revert after the user already clicked Apply unless a dedicated failure UI is added.

Revert path:

- Restore only memory state to the previous committed value.
- Do not write the rejected preview value to storage.

## Scaling Implementation

Add an app-level scale application layer that reads the effective `uiScale`.

Preferred CSS approach:

- Set `--app-ui-scale` on each window root from the settings store.
- Scale content roots, not Tauri windows.
- Main window: apply to `.app-root`.
- Settings window: apply to the Settings panel content root while preserving the window-sized mask/dialog layer.

Use `zoom: var(--app-ui-scale)` where it behaves correctly in the Tauri WebView. If testing shows issues with hit testing or layout, use `transform: scale(var(--app-ui-scale))` plus inverse width/height compensation on the scaled content wrapper.

The modal mask itself should not be inside the scaled content wrapper. It must cover the full Settings window regardless of the current preview scale.

## Slider Behavior

Replace the click-only slider interaction with pointer capture:

- `pointerdown`: capture pointer, compute value immediately, and begin/update dangerous preview.
- `pointermove`: while captured, continuously compute and dispatch preview value.
- `pointerup` / `pointercancel`: release pointer. Do not commit automatically.
- Keyboard support should continue to use `role="slider"` and update preview with arrow/home/end keys if implemented in this pass.

Throttle dispatch only if necessary. If throttling is added, the final pointer position must always be dispatched.

## Dialog Component

Add a reusable dialog component for dangerous changes, for example `DangerousChangeDialog`.

Responsibilities:

- Render a mask covering the Settings window.
- Render the `bfMCZ`-matching dialog.
- Show countdown text derived from `dangerousChange.expiresAt`.
- Call apply or revert actions with the pending id.
- Own the interval/timer that refreshes countdown display and triggers revert when expired.

The component should be generic over dangerous change metadata, but only `uiScale` copy is required now.

Example copy:

- Title: `应用界面缩放？`
- Body: `界面缩放会立即影响所有窗口。如果当前比例导致界面难以操作，倒计时结束后会自动还原。`
- Countdown: `剩余 Ns 后自动还原`
- Buttons: `取消`, `应用`

## Error Handling

- If a stale apply/revert id arrives after a newer dangerous change exists, ignore it.
- If the Settings window is closed while a dangerous change is pending, main should revert the pending change. This prevents leaving the app in an unconfirmed preview state.
- If the settings bridge disconnects or a dispatch fails in tests/non-Tauri mode, existing swallow behavior may remain, but domain unit tests should cover main-store behavior directly.
- If persisted settings are malformed, ignore them and keep defaults.

## Tests

Add or update tests in `app/src/domain/settings.test.ts`:

- `previewDangerousUiScale` clamps values and records previous/next values.
- Updating the same pending `uiScale` change refreshes `nextValue` and expiry without changing `previousValue`.
- `revertDangerousChange` restores the previous committed value.
- `applyDangerousChange` updates `committedUiScale` and clears pending state.
- Stale pending ids are ignored.

Add or update bridge tests:

- `buildSnapshot` includes effective `uiScale`, committed scale, and pending dangerous change.
- settings-window mode dispatches preview/apply/revert actions instead of mutating local source state.
- `applySnapshotToMirrors` mirrors pending dangerous state without mutating `activeTab`.

Add or update UI tests in `app/src/ui/SettingsPanel.test.tsx`:

- Pointer drag moves the slider value continuously.
- Dangerous preview shows a blocking mask and dialog.
- Apply button calls the apply action.
- Cancel button calls the revert action.
- Countdown expiry triggers revert with fake timers.

Add or update app/root CSS tests if CSS is parsed in tests:

- Main content root consumes `--app-ui-scale`.
- The modal mask/dialog layer is outside the scaled content wrapper or otherwise has full-window coverage.

## Implementation Notes

- Keep direct UI mutations out of `SettingsPanel.tsx`; it should call store actions.
- Keep persistence out of the bridge layer; bridge carries commands and snapshots only.
- Keep the dangerous-setting model generic, but avoid building a registry or plugin system until there is a second dangerous setting.
- Preserve existing `activeTab` local behavior in the settings window.
- Preserve the existing generation guards and network/stateSync behavior; this work should not touch WebSocket lifecycle code.
