# Mouse Input Counter Design

**Date**: 2026-05-20
**Modules**: `app/src-tauri/src/key_counter.rs`, `app/src-tauri/src/accessibility/`, `app/src/domain/bindingKey.ts`, `app/src/ui/SettingsPanel.tsx`, `app/src/ui/InputCounterPanel.tsx`, `app/src/ui/PlayerCard.tsx`
**Design source**: `AUI/PUI.pen` nodes `b3JhDJ` (`mouse-left-icon`), `D5QXi1` (`mouse-right-icon`), `vni0R` (`mouse-middle-icon`), `V6oWr` (`mouse-icons-section-header`)

## Context

The current input counter only listens to keyboard events:

- Rust `key_counter::spawn_listener` listens to macOS `CGEventType::KeyDown` or Windows `WH_KEYBOARD_LL`.
- `ListenerHandle::ensure_running` emits `key-pressed` with a single numeric key code.
- `useBindingKeyListener` completes capture or increments counts by comparing `BindingKeyEntry.keyCode`.
- Settings, the independent input counter window, and remote player cards all render a text key badge.

This cannot represent mouse buttons without either overloading `keyCode` with fake values or adding a typed input model. The Pencil file already contains the mouse button visuals, so the implementation should consume those shapes rather than invent a new mouse style.

## Goals

- Count left, middle, and right mouse button down events in the same feature area as keyboard input counting.
- Let a binding row capture either a keyboard key or one of the three mouse buttons.
- Render mouse bindings with the existing Pencil mouse icon shapes, not plain text labels.
- Preserve the current settings-window, input-counter-window, and bridge ownership model: the main window remains the source of truth.
- Keep remote sync compatible with the current server protocol by continuing to send `bindingKey: { keyLabel, pressCount }`.
- Ship both macOS and Windows native listener support in the same implementation pass.

## Non-Goals

- No scroll-wheel, side-button, double-click, long-press, or per-device mouse support.
- No server protocol version bump for this pass.
- No new Pencil design work; the required mouse icon nodes already exist.
- No split store dedicated to mouse counting.
- No change to transparent-window hit testing or whole-window click-through behavior.

## Approaches Considered

### Recommended: typed input event and typed binding

Generalize the current key counter into an input counter. Native code emits a typed payload:

```ts
type InputPressedEvent =
  | { kind: 'keyboard'; code: number }
  | { kind: 'mouse'; button: 'left' | 'middle' | 'right' };
```

Frontend bindings store a canonical input identity:

```ts
type BindingInput =
  | { kind: 'keyboard'; code: number }
  | { kind: 'mouse'; button: 'left' | 'middle' | 'right' };
```

This is the default choice because it keeps keyboard and mouse behavior in one existing user-facing feature while making the data model explicit enough for tests, UI rendering, and future platform work.

### Alternative: fake mouse key codes

Keep `key-pressed: number` and reserve negative or very large numeric codes for mouse buttons. This is smaller at first, but it makes every caller remember magic ranges and risks collisions with platform key codes. It also makes remote/debug labels harder to reason about.

### Alternative: separate mouse counter feature

Add separate native hooks, store, settings rows, and panel rendering for mouse counting. This avoids changing existing keyboard data, but it duplicates almost all behavior and creates two user concepts where the product needs one: input counting.

## Design

### Native listener

Rename behavior conceptually from "key counter" to "input counter", but keep the existing Tauri command names and listener health event names stable for this pass to limit churn. The listener remains gated by the existing `accessibility` module and health state.

macOS should install one listen-only `CGEventTap` that listens to:

- `KeyDown`
- `LeftMouseDown`
- `RightMouseDown`
- `OtherMouseDown`

`KeyDown` emits `{ kind: 'keyboard', code }`. `LeftMouseDown` and `RightMouseDown` emit their direct mouse buttons. `OtherMouseDown` reads the CoreGraphics mouse button number and only emits middle button when the button is `2`; other buttons are ignored.

Windows should install both low-level hooks under the same listener lifecycle:

- `WH_KEYBOARD_LL` for `WM_KEYDOWN` and `WM_SYSKEYDOWN`
- `WH_MOUSE_LL` for `WM_LBUTTONDOWN`, `WM_MBUTTONDOWN`, and `WM_RBUTTONDOWN`

Both hooks feed the same internal channel and stop from the same `AtomicBool`. If one hook fails to install, startup should fail with a visible `listenerError` rather than reporting a half-running listener.

The Tauri event should move to `input-pressed` with the typed payload. To reduce migration risk, implementation may also emit legacy `key-pressed` for keyboard events only while tests and callers are moved over. Mouse events must not be squeezed into `key-pressed`.

### Domain model

`BindingKeyEntry` should gain a canonical typed input field while preserving migration from the current shape:

```ts
interface BindingKeyEntry {
  id: string;
  label: string;
  keyCode: number;
  input: BindingInput | null;
  pressCount: number;
  enabled: boolean;
}
```

`keyCode` stays temporarily for compatibility with existing bridge snapshots and tests, but new behavior compares `input`, not `keyCode`. Existing entries with `input` missing are interpreted as keyboard entries when `keyCode >= 0`; unbound entries remain `input: null`.

Store actions should become input-oriented:

- `completeCapture(input, label)` records the typed input and resets `pressCount`.
- `incrementByInput(input)` increments enabled entries with the same typed input.
- `isVisibleBindingEntry` returns true when `entry.enabled && entry.input !== null`.

Keyboard label generation continues through `labelForKeyCode`. Mouse labels are:

- `鼠标左键`
- `鼠标中键`
- `鼠标右键`

### Settings capture behavior

When a binding row is capturing, the next keyboard keydown or supported mouse button down completes the capture. On Windows, the settings-window fallback currently listens to DOM `keydown`; it should also listen to DOM `pointerdown` while capturing so capture still works if the native hook is unavailable in the focused settings window. The DOM fallback should only complete for primary, middle, and secondary buttons.

Change the add button label from `添加按键` to `添加输入` because the row can bind keyboard or mouse.

### Visual rendering

Create one reusable React component for the binding badge:

```tsx
<InputBindingBadge input={entry.input} label={entry.label} />
```

Keyboard bindings render the existing small text key badge. Mouse bindings render a compact icon derived from Pencil nodes:

- `b3JhDJ` for left button
- `vni0R` for middle button
- `D5QXi1` for right button

The icon should reuse the exact design language from Pencil: dark body `#5B4636`, light split/indicator `#FFF3EA`, transparent frame, scaled down to the badge size. The implementation can use inline SVG or CSS-backed SVG components; it should not generate bitmap assets unless the final visual match requires it.

Apply the badge component in all places that currently render a key badge:

- `SettingsPanel` binding rows
- `InputCounterPanel` pill
- `PlayerCard` remote key counter pill

Remote player cards only receive `keyLabel`, not typed input. If the label is one of the three mouse labels, the card should render the matching mouse icon. Otherwise it renders the text key badge.

### Bridge and remote sync

The local mirror bridge must clone and dispatch `BindingKeyEntry.input` along with the existing fields. The main window remains authoritative; settings-window actions still dispatch to the main window.

Server protocol stays at version `1`. `RemoteBindingKey` remains:

```ts
type RemoteBindingKey = {
  keyLabel: string;
  pressCount: number;
};
```

This keeps old and new clients interoperable. New clients can infer mouse icon rendering from the label. Old clients will simply display the Chinese mouse label as text.

### Error handling

- Unsupported mouse buttons are ignored and do not cancel capture.
- If keyboard hook installation succeeds but mouse hook installation fails on Windows, listener health should report a startup error and the UI should show the existing retry banner.
- If a typed payload is malformed, the frontend ignores it.
- If a mirrored entry is missing `input`, the frontend derives keyboard input from `keyCode` to keep existing saved state usable.

## Testing

Frontend tests:

- `bindingKey.test.ts`: complete capture with keyboard input, complete capture with mouse input, increment only matching typed input, derive old `keyCode` entries as keyboard input.
- `InputCounterPanel.test.tsx`: mouse binding pill renders the correct icon and count; mixed keyboard/mouse rows remain stable.
- `SettingsPanel.test.tsx`: capturing can complete from a mouse event; add/capture dispatch still goes through the main window in settings-window mode.
- `PlayerCard.test.tsx`: remote labels `鼠标左键`, `鼠标中键`, and `鼠标右键` render mouse icons; ordinary labels still render text badges.
- Bridge tests: snapshots preserve `entry.input`; dispatch signature includes typed capture payload.

Rust tests:

- Unit-test event mapping helpers for macOS mouse event types and Windows mouse messages where they can be isolated without real hooks.
- Keep existing listener health tests and extend failure behavior so partial native hook startup does not report `listenerRunning=true`.

Manual verification:

1. macOS dev build with Accessibility permission: add a binding, click left/middle/right mouse button, confirm capture label and icon.
2. macOS: click the captured mouse button in another foreground app and confirm the independent input counter increments.
3. Windows build: repeat left/middle/right capture and count verification.
4. Remote room: sync a mouse binding and confirm the other player card shows the matching mouse icon and count.
5. Regression: keyboard capture/count still works; unbound entries do not show the independent input counter window.

## Implementation Order

1. Add shared TypeScript input identity helpers and badge rendering component.
2. Update store actions and tests from key-code comparison to typed input comparison, keeping migration from `keyCode`.
3. Update settings, input-counter, player-card, and bridge rendering/dispatch.
4. Change native listener payload to `input-pressed`, with macOS keyboard+mouse mapping.
5. Add Windows mouse hook under the same listener lifecycle.
6. Run focused tests, full app tests, build, and platform manual checks.
