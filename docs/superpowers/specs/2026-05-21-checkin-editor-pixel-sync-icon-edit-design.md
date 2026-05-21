# Check-in Editor Pixel Sync and Icon Editing Design

**Date**: 2026-05-21
**Status**: Approved by delegated defaults
**Design source**: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/PUI.pen`, node `s6g1w` (`Check-in Plan Editor Panel`)

## Context

The current `CheckinPlanEditorPanel` implementation has drifted from the Pencil source of truth. The selected browser diff comments point at the add-item module and date selector as visibly inconsistent with node `s6g1w`. The active Pencil editor may point at another worktree, so all Pencil reads and writes must pass the explicit current-worktree file path:

`/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/PUI.pen`

The project already contains generated check-in icon assets in `app/public/checkin-icons/`. They were generated to match the reference Pencil icon style from:

- `YIVxx/GOGW7`
- `YIVxx/o9i6o1`
- `YIVxx/AlRGc`

The icons are white/currentColor assets by default so the code can apply each item color.

## Recommended Approach

Use a design-first pixel sync pipeline.

1. Update Pencil node `s6g1w` first: replace item-row color dot `W0QrF` with an icon glyph matching the existing Pencil icon style, and keep `YVc3O` visually recognizable as the editable "每次" metric field.
2. Export the updated `s6g1w` baseline image from Pencil.
3. Sync the static HTML prototype first, using the exported image for browser side-by-side comparison.
4. After the HTML prototype matches the design, import the same structure and CSS into the React/Tauri app.
5. Verify behavior with Vitest, then verify pixels in the in-app browser dev-align view.

This is preferred over directly patching React because the design currently has the clearest hierarchy and the user explicitly asked to change the design before import. It is also safer than rebuilding the panel from scratch because the existing check-in store, icon assets, and tests can be reused.

## Goals

- Pixel-sync the entire `CheckinPlanEditorPanel` to Pencil node `s6g1w`.
- Make every plan item row editable.
- Make node `YVc3O` ("每次" metric) editable for each item.
- Replace the visual role of dot node `W0QrF` with an icon.
- Clicking an item icon opens an icon picker using the generated icon set already in the project.
- Enforce a single Pomodoro plan item: if a `pomodoroFocus` item already exists in the current day plan, "番茄钟" cannot be selected when adding another item.
- Preserve the generated icon style: thin white/currentColor stroked glyphs, color applied by code.
- Keep the current check-in persistence model compatible with existing saved data.

## Non-Goals

- No new icon generation in this pass unless the existing asset set is missing from the project.
- No cloud sync or WebSocket protocol changes.
- No redesign of the compact today check-in panel beyond using the same icon renderer where item rows already display icons.
- No historical weekly plan editor.
- No change to the encrypted `.pen` access rule; Pencil MCP remains the only way to read or write `AUI/PUI.pen`.

## Pencil Design Changes

The work must target the current worktree `.pen` file explicitly.

`s6g1w` remains the reusable `Check-in Plan Editor Panel` component with:

- Width `460`.
- Outer padding `16`.
- Gap `14`.
- Radius `24`.
- Fill `#FFFDFBEE`.
- Stroke `#EFDCCD`.

The item rows under `q3Q0L8` keep the current card hierarchy and spacing. The `W0QrF` 10x10 ellipse in the "阅读" row becomes an icon-style glyph position. Equivalent glyph positions are used for the "喝水" and "专注番茄" rows. The icon should visually match the reference Pencil glyphs from `YIVxx/GOGW7`, `YIVxx/o9i6o1`, and `YIVxx/AlRGc`: lucide-like, thin stroke, compact, no filled badge behind it.

`YVc3O` stays visually aligned to the Pencil metric frame:

- Width `86`.
- Radius `12`.
- Padding `[6,8]`.
- Label text `每次`.
- Value/unit row, e.g. `30 分钟`.

The implementation may render the value as an input while preserving the exact frame, typography, and spacing. The design intent is an inline editable control, not a modal-only edit.

## Editor Behavior

The editor operates on a local draft. Save commits the draft into the check-in store; cancel discards it.

Each item row supports these editable fields:

- Icon.
- Title.
- Per-use metric value and unit (`YVc3O`).
- Daily target count.

The item type is selected when the item is created. Existing item type is locked after creation to avoid converting records between incompatible semantics. Pomodoro items remain editable for icon, title, per-use metric, and target count.

Clicking an item icon opens a compact icon picker in the row area or as a small popover anchored to the icon. The picker displays the generated icon options:

- `activity`
- `dumbbell`
- `bookOpen`
- `droplet`
- `listChecks`
- `sparkle`
- `coffee`
- `moon`
- `sun`
- `leaf`
- `music`
- `pencil`
- `target`
- `flame`
- `heart`
- `apple`
- `clock`
- `meditation`

The selected icon is stored on the item as an icon key. If a saved item has no icon, the UI falls back to a type/title-based default.

## Pomodoro Uniqueness

Pomodoro plan items are unique per day plan. When the current editable day already contains a `pomodoroFocus` item:

- The new-item type selector disables or hides the "番茄钟" option.
- Existing Pomodoro item rows remain editable.
- Saving also validates the draft and keeps at most one Pomodoro item for the day.

The user-facing behavior is: once a Pomodoro item exists, a second Pomodoro item cannot be chosen from the add flow.

## Data Model

Extend `CheckinItem` with optional icon and metric fields while preserving older persisted snapshots:

```ts
export type CheckinItemIcon =
    | 'activity'
    | 'dumbbell'
    | 'bookOpen'
    | 'droplet'
    | 'listChecks'
    | 'sparkle'
    | 'coffee'
    | 'moon'
    | 'sun'
    | 'leaf'
    | 'music'
    | 'pencil'
    | 'target'
    | 'flame'
    | 'heart'
    | 'apple'
    | 'clock'
    | 'meditation';

export interface CheckinItem {
    id: string;
    title: string;
    type: CheckinItemType;
    targetCount: number;
    icon?: CheckinItemIcon;
    perUseAmount?: number;
    perUseUnit?: string;
}
```

Persistence validation accepts only known icon keys. Unknown icon values are dropped during load so corrupted snapshots cannot break rendering.

## UI Mapping

The React component maps to Pencil hierarchy rather than inventing a new panel layout:

- Header maps to `N4Xz7`.
- Date selector maps to `mCWPj`, including the two-row day pill layout.
- Selected-day card maps to `B3Lqo`.
- Day content card maps to `vyLe0`.
- Add-item type choice maps to `GEZ1n`.
- Item rows map to `UVCjO`, `tn3qb`, and `b9hee`.
- Advanced carry-forward row maps to `TqJ88`.
- Apply row maps to `lPZdc`.

The dev-align target remains `s6g1w-html`: left side is the Pencil export baseline, right side is the implemented HTML/React render.

## Error Handling

- If a loaded icon key is unknown, drop it and use the default icon.
- If an edited metric value is blank, save it as `0` only after explicit user input; otherwise preserve the previous value.
- If a metric value is negative or non-numeric, clamp to `0`.
- If a unit is blank, fall back to the prior unit, then to `次`.
- If a saved day contains multiple Pomodoro items, the editor keeps the first in display order and converts subsequent Pomodoro additions back to manual items before saving.

## Testing

Domain and persistence tests:

- Icon keys persist and unknown icon keys are rejected.
- Per-use metric value and unit persist.
- A saved day cannot contain two Pomodoro items after editor save normalization.

UI tests:

- The add-type selector does not allow "番茄钟" when a Pomodoro item already exists.
- Clicking an item icon opens the icon picker.
- Choosing an icon updates the draft row.
- Editing `YVc3O` changes the per-use metric.
- Editing an item title and target count updates only the draft until save.
- Cancel discards row edits.

Visual verification:

- Export updated `s6g1w` from Pencil.
- Compare static HTML prototype against the export.
- Import the synced panel into the React app.
- Open `http://127.0.0.1:1420/?window=devalign&target=s6g1w-html`.
- Confirm the whole panel, especially the date selector and add-item module, matches the updated Pencil baseline before stopping.

## Spec Self-Review

- Completion-marker scan: no unresolved requirement markers remain.
- Consistency check: Pencil changes, HTML sync, React import, and dev-align verification follow one ordered pipeline.
- Scope check: this is one focused editor-panel refinement, not a new check-in subsystem.
- Ambiguity check: Pomodoro uniqueness applies per editable day plan; existing Pomodoro rows stay editable but item type is locked after creation.
