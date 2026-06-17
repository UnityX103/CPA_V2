# DzDyI Count/Cycle Pixel Sync Design

## Context

Pencil node `DzDyI` is the source of truth for the check-in plan editor panel. It contains `s6g1w` (`Check-in Plan Editor Panel`) and the reusable row `nT8zR` (`Component/RepeatPlanItemRow`). The row has two visual states:

- Cycle state: bottom controls are `repeat/cycle-select` plus seven weekday pills.
- Count state: the same row shell and top area remain in place, while the bottom controls become `count/value-input`, `count/unit-dropdown`, and `count/loop-input`.

The current React implementation already uses one component and switches the bottom controls based on `item.editMode`, but the count-state geometry has drifted from the Pencil state. In particular, the count controls are not governed by the same shared controls contract as the cycle controls, and the unit control width is `92px` in CSS while Pencil specifies `96px`.

## Goal

Make the count-editing state and cycle-editing state feel like pixel-level states of the same `DzDyI` row, without changing check-in business semantics or persistence.

## Design

Use the existing `CheckinPlanEditorPanel` component and keep the current data flow untouched. The visual fix is CSS-first:

- Keep `.checkin-editor-item-row`, `.checkin-editor-item-top`, icon, copy, mode toggle, and row action shared for both states.
- Treat `.checkin-editor-item-controls` as the common bottom-state container.
- Keep cycle state aligned to Pencil: cycle select width `94px`, day pills fill the remaining row width, controls gap `8px`.
- Update count state to match Pencil: controls are one horizontal row with widths `75px`, `96px`, and `112px`, gap `6px`, height `36px`, radius `12px`, and matching border/background colors.
- Preserve the count loop emphasis: the third field uses `#FFF7F0` and `#EFDCCD`; the first two use `#FFFFFFCC` and `#E5E7EB`.

## Testing

Add focused coverage in `CheckinPlanEditorPanel.test.tsx` that renders both states from the same template and verifies the expected state classes/field structure are present. Add a CSS contract test for the Pencil geometry values that are easy to regress: cycle select width, count control widths, count gap, field height, and highlighted loop field styling.

Manual visual validation may still be needed for true pixel-level confidence, but the automated tests will lock the exact geometry constants that caused this drift.

## Out Of Scope

- No changes to `AUI/PUI.pen`.
- No changes to check-in domain data, persistence, bridge snapshots, or Tauri window behavior.
- No broader editor redesign or unrelated typography/color changes.
