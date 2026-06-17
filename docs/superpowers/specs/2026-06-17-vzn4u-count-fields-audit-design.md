# VZN4U Count Fields Audit Design

## Context

Pencil node `VZN4U` is the count-editing content row inside `DzDyI` / `s6g1w`. It contains three controls:

- `R8wI7` (`count/value-input`): label `每次数量`, width `75px`, value example `4`.
- `cwqXn` (`count/unit-dropdown`): label `单位`, width `96px`, value example `/ 个`, with a chevron.
- `fiNze` (`count/loop-input`): label `循环次数`, width `112px`, value example `1 轮`, highlighted with `#FFF7F0` / `#EFDCCD`.

The current React count state displays three controls, but the first two are semantically wrong:

- The first control is labelled `输入值` and writes `countInputValue`.
- The second control is labelled `每轮次数` and writes `countUnitSize`.
- The third control writes `countLoopCount`, which matches Pencil.

The domain already has durable fields for the user-facing quantity and unit: `perUseAmount` and `perUseUnit`. Today check-in completion and `+1` logic use `targetCount`, not these count-editing metadata fields.

## Goal

Make `VZN4U` visually and functionally match Pencil while preserving existing persisted data.

## Design

Update only `CheckinPlanEditorPanel` and focused tests.

- `R8wI7` maps to `perUseAmount`.
  - Label: `每次数量`.
  - Input value fallback: `item.perUseAmount ?? item.countInputValue ?? 1`.
  - On change: write `perUseAmount`.
  - It must not write `targetCount`, `countUnitSize`, or `countLoopCount`.
- `cwqXn` maps to `perUseUnit`.
  - Label: `单位`.
  - Input value fallback: `item.perUseUnit ?? item.countUnitLabel ?? '次'`.
  - On change: write `perUseUnit`.
  - It must not write `countUnitSize`.
- `fiNze` maps to `countLoopCount`.
  - Label: `循环次数`.
  - Input value fallback: `item.countLoopCount ?? 1`.
  - On change: write `countLoopCount`.

Keep legacy fields normalized and persisted for compatibility. Do not remove or migrate `countInputValue`, `countUnitSize`, or `countUnitLabel` in this patch. The UI simply stops treating those names as the primary Pencil controls.

## Testing

Add failing tests before implementation:

- Editing `R8wI7` changes `perUseAmount` on save and leaves `targetCount`, `countUnitSize`, and `countLoopCount` intact.
- Editing `cwqXn` changes `perUseUnit` on save and leaves `countUnitSize` intact.
- Editing `fiNze` changes `countLoopCount` on save and leaves `perUseAmount` and `perUseUnit` intact.
- The CSS/structure contract still locks `VZN4U` labels and geometry.

## Out Of Scope

- No Pencil source edits.
- No changes to daily progress, `+1`, `targetCount`, persistence schema version, or Tauri window behavior.
- No removal of legacy count metadata fields.
