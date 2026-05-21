# Check-in Editor Panel Drag Design

**Date**: 2026-05-21
**Status**: Approved by delegated defaults
**Scope**: `app/src/ui/CheckinPlanEditorPanel.tsx`, `app/src/ui/CheckinPlanEditorPanel.test.tsx`

## Context

The check-in plan editor opens in its own transparent, decorationless Tauri window. Other panels in the app already allow native window dragging from non-interactive panel areas by calling `getCurrentWindow().startDragging()` from a root-level pointer handler and filtering targets through `shouldStartWindowDrag`.

`CheckinPlanEditorPanel` currently lacks this pointer handler, so the editor window cannot be dragged from its background or ordinary panel regions.

## Goals

- Make the check-in plan editor draggable from ordinary non-interactive panel areas.
- Match the existing drag behavior used by the Pomodoro, Settings, Today Check-in, Player Card, and Input Counter panels.
- Preserve all editor controls: day buttons, rest toggle, add/delete buttons, inputs, selects, carry toggle, save, and cancel must remain normal click/input targets.
- Cover the behavior with focused component tests.

## Non-Goals

- No visual redesign of the editor panel.
- No Rust or Tauri window builder changes.
- No changes to hit-test passthrough behavior.
- No new drag handle UI.

## Recommended Approach

Reuse the existing shared drag helper:

1. Import `getCurrentWindow` from `@tauri-apps/api/window`.
2. Import `shouldStartWindowDrag` from `./windowDrag`.
3. Add a root `onPointerDown` handler to `CheckinPlanEditorPanel`.
4. If `shouldStartWindowDrag(e.button, e.target)` returns true, call `getCurrentWindow().startDragging()`.
5. Catch and swallow rejected drags, matching the existing panel pattern for tests and non-Tauri environments.

This keeps the behavior consistent and avoids adding a second drag-target rule system.

## Alternatives Considered

### CSS App Region

Using `-webkit-app-region: drag` on the panel and `no-drag` on controls would be compact, but this editor contains many interactive descendants. It is easier to miss a current or future control, and the app already standardized on the pointer-handler approach.

### Dedicated Header Drag

Dragging only from the editor header would be simple, but it would not match the user's request for behavior like the existing panels, where ordinary blank regions can be used as drag starts.

### New Shared Component Wrapper

A generic draggable panel wrapper could reduce repetition, but this change is too small to justify a new abstraction. The current helper already centralizes the important rule: which DOM targets should not begin a window drag.

## Interaction Rules

Drag should start from:

- The editor panel root background.
- The header/title area when the target is not a control.
- Section backgrounds, empty states, rest-state background, and ordinary layout gaps.

Drag should not start from:

- `button`
- `input`
- `select`
- `textarea`
- `a`
- Elements with `role="button"` or `role="slider"`
- Elements or descendants marked with `data-no-window-drag`

Only the primary pointer button starts a drag.

## Error Handling

`startDragging()` may reject outside Tauri or in tests. The handler should catch and ignore the error, following the same behavior as the other panels.

## Testing

Update `CheckinPlanEditorPanel.test.tsx` to mock `@tauri-apps/api/window` and verify:

- Pointer down on the editor panel background starts native drag.
- Right-click pointer down does not start native drag.
- Pointer down on an editor button does not start native drag.
- Pointer down on an input does not start native drag.
- Pointer down on a select does not start native drag.

Run:

```bash
cd app
npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx
```

If this passes, run the broader frontend test suite when practical:

```bash
cd app
npm test
```

## Self-Review

- The scope is limited to the editor panel and its tests.
- The design uses the existing shared drag helper instead of introducing new rules.
- Interactive controls remain explicitly protected by the shared helper.
- No platform-specific native behavior changes are required.
