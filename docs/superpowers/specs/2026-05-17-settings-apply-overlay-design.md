# Settings Apply Overlay Design

**Date**: 2026-05-17
**Project**: CPA_V2 Tauri rewrite
**Scope**: Make the Settings `应用` action a reusable floating overlay that appears only when the active settings section has pending ordinary changes.

## Context

`AUI/PUI.pen` already contains a reusable `SettingsApplyRow` component (`EOrsv`) and the unified settings panel (`vnYnS`) already places an `uspApply` instance in the content area as an absolute-positioned row.

The current React implementation does not fully match that global structure. `PomodoroTab` renders its own `.apply-row`, keeps it visible when no changes exist by disabling the button, and adds `.tab-pane.has-apply` padding so the row does not cover the first card. That makes the Apply action feel permanently present, visually tight against its white background, and local to the Pomodoro tab instead of reusable by later settings panels.

The current working tree has unresolved conflicts from adjacent Pomodoro video work. Implementation should keep this change scoped to the settings Apply overlay and avoid unrelated bridge, video-window, or Rust behavior changes.

## Goals

- Hide the Settings `应用` action when the active settings section has no ordinary pending changes.
- Show the action only after the active section becomes dirty.
- Keep the Apply row outside section auto layout so showing or hiding it never changes the layout or scroll position of the settings content.
- Preserve `SettingsApplyRow` as a global reusable setting action that future panels can adopt.
- Increase the Apply row's vertical breathing room so the button is not tight against the white row background.
- Keep Global dangerous-setting confirmation separate from the ordinary Apply row.

## Non-Goals

- Do not redesign all settings tabs.
- Do not introduce cancel/revert behavior for ordinary settings in this pass.
- Do not replace `DangerousChangeDialog`; UI scale preview still uses the dangerous-setting dialog flow.
- Do not resolve unrelated Pomodoro video, bridge, or native merge conflicts as part of this design.
- Do not use a browser-based visual companion for this task.

## Pencil Design

Update `AUI/PUI.pen` first because the Pencil file is the visual source of truth.

In `Unified Settings Panel` (`vnYnS`) under `content` (`NCXdZ`):

- Keep `uspApply` as a `SettingsApplyRow` (`EOrsv`) instance.
- Keep `uspApply` outside normal content layout with `layoutPosition: absolute`.
- Treat `uspApply` as an overlay owned by the unified panel, not by Pomodoro, Online, Pet, or Global panel content.
- Represent the no-change state as hidden. Hidden means it does not visually appear and does not reserve any layout space.
- Preserve right alignment for the `应用` button.
- Keep the button at `120 x 38` unless the existing `Button/Primary` component is intentionally changed.
- Increase the row's vertical space around the button. The row should have enough height or padding that a 38px button has clear top and bottom breathing room, for example a 54-58px overlay row.
- Keep the row background white so the floating action remains readable over scrollable content.

Do not add top padding to `Pomodoro Settings Panel` (`gs1Tv`) or any other section to make room for the overlay. The overlay is allowed to float over the content area; it must not become part of the section's auto layout.

## User Experience

Initial state:

1. Open Settings on any tab with no ordinary pending changes.
2. No `应用` action is visible.
3. Section content starts at its normal top position.

Dirty state:

1. Change a normal setting in the active tab, such as Pomodoro focus duration, break duration, auto-start-break, or end-action settings.
2. The global Apply overlay appears at the top-right of the settings content area.
3. Existing content does not move.
4. The row background and vertical padding keep the button visually separated from surrounding content.

Invalid dirty state:

1. Make a change that is dirty but cannot be applied yet, such as choosing custom video without selecting a file.
2. The overlay appears so the user can see there is pending work.
3. The `应用` button is disabled until the active tab becomes valid.

Apply state:

1. Click `应用`.
2. The active tab commits its ordinary pending changes.
3. Once the tab is clean again, the overlay hides.

Tab switching:

- The overlay reflects the active tab only.
- If a future tab adopts ordinary dirty/apply state, switching to that tab can show its own pending Apply action.
- Tabs that do not register ordinary apply state show no overlay.

## Component Design

Add or extract a reusable UI component:

```ts
type SettingsApplyRowProps = {
  visible: boolean;
  enabled: boolean;
  onApply: () => void;
};
```

Responsibilities:

- Render the `应用` primary button in the shared overlay row.
- Hide when `visible` is false.
- Disable the button when `enabled` is false.
- Keep pointer events active for the button while the non-button row area does not block unrelated content unnecessarily.
- Own only presentation. It should not know Pomodoro, Online, Pet, or Global state.

Place the component once in `SettingsPanel`, inside `.settings-content` as an overlay sibling to the active tab content. Do not render Apply rows from inside individual tabs.

Current Pomodoro tab integration can be simple and focused:

- `PomodoroTab` owns its existing draft state and apply function.
- It exposes ordinary apply metadata to `SettingsPanel`: `dirty`, `canApply`, and `apply`.
- `SettingsPanel` passes those values to `SettingsApplyRow`.

The first implementation does not need a registry or plugin system. A lightweight callback or render-prop shape is enough. The design should still leave the boundary clear so Online, Pet, or Global can provide the same metadata later.

## State Flow

For Pomodoro ordinary settings:

- Draft values remain local to `PomodoroTab`.
- `dirty` means at least one draft value differs from the current committed Pomodoro store value.
- `canApply` means `dirty` is true and the draft is currently valid.
- `apply` calls the existing Pomodoro store actions for only the changed settings.

For Global dangerous settings:

- UI scale preview remains controlled by `previewDangerousUiScale`.
- Confirmation remains controlled by `DangerousChangeDialog`.
- The ordinary `SettingsApplyRow` must not appear for pending dangerous scale preview unless a future design explicitly merges those flows.

## CSS And Layout

`.settings-content` remains the positioning context for the overlay.

The Apply overlay should be absolute positioned, for example:

- `position: absolute`
- `top: 0`
- `left: 0`
- `right: 0`
- `z-index` above scrollable content
- white background
- vertical padding or height that gives the button clear top and bottom spacing
- right-aligned content

Remove the layout-coupling rule that pushes content down for Apply:

- Do not keep `.tab-pane.has-apply` as an active behavior.
- Do not add padding/margin to section content based on Apply visibility.

The scrollable content and cards keep their normal layout whether the overlay is visible or hidden.

## Testing

Update UI tests around the shared Apply behavior:

- Initial Pomodoro settings render has no visible `应用` ordinary Apply button when no ordinary changes exist.
- Changing a Pomodoro setting shows the global Apply overlay.
- Clicking `应用` commits the Pomodoro change and hides the overlay after state returns clean.
- Choosing custom video without selecting a file shows the overlay but leaves the button disabled.
- The Pomodoro tab content no longer uses `.has-apply` to reserve vertical layout space.

Update CSS text guards:

- `.apply-row` is an absolute overlay.
- `.apply-row` has vertical breathing room beyond the 38px button height.
- `.tab-pane.has-apply` is absent or no longer used to reserve layout space.

Preserve existing dangerous-setting tests:

- `DangerousChangeDialog` still appears for UI scale preview.
- Its `应用` button still commits the dangerous change through the dangerous-setting flow.

## Implementation Constraints

- Resolve existing `SettingsPanel.tsx` and `SettingsPanel.test.tsx` merge conflicts before applying this feature.
- Keep implementation edits scoped to Pencil, settings UI, settings UI tests, and CSS.
- Do not change WebSocket generation guards, `stateSync`, Pomodoro timer transition semantics, or native Tauri commands.
- Do not change video playback behavior while implementing the Apply overlay.
