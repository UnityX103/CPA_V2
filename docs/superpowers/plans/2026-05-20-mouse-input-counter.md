# Mouse Input Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing input counter so it can capture and count keyboard keys plus left, middle, and right mouse button presses.

**Architecture:** Keep the current binding-key feature as the single source of truth, but replace key-code-only matching with a typed input identity. Rust emits typed `input-pressed` events from one listener lifecycle, and React renders keyboard text badges or Pencil-derived mouse icons through one shared badge component.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Zustand, Vitest, jsdom, CoreGraphics event taps, Win32 low-level keyboard and mouse hooks.

---

## File Structure

- Create `app/src/ui/InputBindingBadge.tsx`: shared badge renderer for keyboard labels and mouse button icons.
- Create `app/src/ui/InputBindingBadge.css`: badge and compact mouse-icon styles mapped to Pencil nodes `b3JhDJ`, `D5QXi1`, and `vni0R`.
- Modify `app/src/domain/bindingKey.ts`: define typed input identities, migrate existing `keyCode` entries, listen to `input-pressed`, and compare typed inputs.
- Modify `app/src/domain/bindingKey.test.ts`: cover typed input capture, count matching, legacy `keyCode` migration, and malformed payload ignores.
- Modify `app/src/domain/bridge/protocol.ts`: change `completeCapture` dispatch args to typed input plus label.
- Modify `app/src/domain/bridge/host.ts`: apply typed capture payloads and include `input` in bridge signatures.
- Modify `app/src/domain/bridge/client.ts`: clone mirrored entries with `input`.
- Modify bridge tests under `app/src/domain/bridge/*.test.ts`: update snapshots and dispatch payloads.
- Modify `app/src/ui/SettingsPanel.tsx`: render `InputBindingBadge`, dispatch typed capture, and capture supported mouse buttons from DOM fallback on Windows.
- Modify `app/src/ui/SettingsPanel.css`: adjust binding row layout for mouse-icon badges and `添加输入` copy.
- Modify `app/src/ui/SettingsPanel.test.tsx`: cover mouse capture and label copy.
- Modify `app/src/ui/InputCounterPanel.tsx`: render `InputBindingBadge` inside counter pills.
- Modify `app/src/ui/InputCounterPanel.css`: remove badge-specific CSS now owned by `InputBindingBadge.css` or keep only pill layout.
- Modify `app/src/ui/InputCounterPanel.test.tsx`: cover mouse badge rendering in the independent panel.
- Modify `app/src/ui/PlayerCard.tsx`: infer mouse badge rendering from remote `keyLabel`.
- Modify `app/src/ui/PlayerCard.css`: share badge styles or remove duplicated key badge rules.
- Modify `app/src/ui/PlayerCard.test.tsx`: cover remote mouse labels.
- Modify `app/src/domain/stateSync.ts` and `app/src/domain/stateSync.test.ts`: keep server payload as `{ keyLabel, pressCount }` while using typed local entries.
- Modify `app/src-tauri/src/key_counter.rs`: emit typed keyboard and mouse events on macOS and Windows.
- Modify `app/src-tauri/src/accessibility/mod.rs`: emit `input-pressed` payloads from `ListenerHandle` while preserving listener health.
- Modify `app/src-tauri/src/lib.rs`: no new commands expected; only adjust imports if Rust event payload types move.
- Modify `app/src-tauri/Cargo.toml`: add Win32 feature flags only if `MSLLHOOKSTRUCT` or mouse constants require an additional feature.

## Task 1: Typed Input Domain Contract

**Files:**
- Modify: `app/src/domain/bindingKey.ts`
- Test: `app/src/domain/bindingKey.test.ts`

- [ ] **Step 1: Write failing domain tests**

Add these tests to `app/src/domain/bindingKey.test.ts` near the main-store tests:

```ts
it('captures and increments typed keyboard input', () => {
    const store = createBindingKeyStore({ isSettingsWindow: false });
    const id = store.getState().addEntry();

    store.getState().completeCapture({ kind: 'keyboard', code: 49 }, 'Space');
    store.getState().incrementByInput({ kind: 'keyboard', code: 49 });
    store.getState().incrementByInput({ kind: 'keyboard', code: 50 });

    expect(store.getState().entries[0]).toEqual(expect.objectContaining({
        id,
        label: 'Space',
        keyCode: 49,
        input: { kind: 'keyboard', code: 49 },
        pressCount: 1,
    }));
});

it('captures and increments typed mouse input', () => {
    const store = createBindingKeyStore({ isSettingsWindow: false });
    store.getState().addEntry();

    store.getState().completeCapture({ kind: 'mouse', button: 'left' }, '鼠标左键');
    store.getState().incrementByInput({ kind: 'mouse', button: 'left' });
    store.getState().incrementByInput({ kind: 'mouse', button: 'right' });

    expect(store.getState().entries[0]).toEqual(expect.objectContaining({
        label: '鼠标左键',
        keyCode: -1,
        input: { kind: 'mouse', button: 'left' },
        pressCount: 1,
    }));
});

it('derives old keyCode entries as keyboard input for visibility and counting', () => {
    const store = createBindingKeyStore({ isSettingsWindow: false });
    store.setState({
        entries: [
            { id: 'old', label: 'A', keyCode: 0, pressCount: 2, enabled: true },
        ] as any,
    });

    expect(store.getState().entries[0].input).toBeUndefined();
    store.getState().incrementByInput({ kind: 'keyboard', code: 0 });

    expect(store.getState().entries[0].pressCount).toBe(3);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd app && npx vitest run src/domain/bindingKey.test.ts
```

Expected: FAIL because `completeCapture` still accepts `(keyCode, label)`, `incrementByInput` does not exist, and entries do not have `input`.

- [ ] **Step 3: Add typed input helpers**

In `app/src/domain/bindingKey.ts`, add these exports near the key label maps:

```ts
export type MouseButton = 'left' | 'middle' | 'right';

export type BindingInput =
    | { kind: 'keyboard'; code: number }
    | { kind: 'mouse'; button: MouseButton };

export type InputPressedEvent = BindingInput;

export const MOUSE_BUTTON_LABELS: Record<MouseButton, string> = {
    left: '鼠标左键',
    middle: '鼠标中键',
    right: '鼠标右键',
};

export function inputForLegacyKeyCode(keyCode: number): BindingInput | null {
    return keyCode >= 0 ? { kind: 'keyboard', code: keyCode } : null;
}

export function labelForInput(input: BindingInput, platform: BindingKeyPlatform | null = 'macos'): string {
    return input.kind === 'keyboard'
        ? labelForKeyCode(input.code, platform)
        : MOUSE_BUTTON_LABELS[input.button];
}

export function inputsEqual(a: BindingInput | null | undefined, b: BindingInput | null | undefined): boolean {
    if (!a || !b || a.kind !== b.kind) return false;
    return a.kind === 'keyboard' ? a.code === (b as { kind: 'keyboard'; code: number }).code : a.button === (b as { kind: 'mouse'; button: MouseButton }).button;
}

export function normalizeEntryInput(entry: Pick<BindingKeyEntry, 'input' | 'keyCode'>): BindingInput | null {
    return entry.input ?? inputForLegacyKeyCode(entry.keyCode);
}
```

Extend `BindingKeyEntry`:

```ts
input?: BindingInput | null;
```

Change action signatures:

```ts
completeCapture: (input: BindingInput, label: string) => void;
incrementByInput: (input: BindingInput) => void;
```

Update new entries:

```ts
input: null,
```

Update `completeCapture`:

```ts
completeCapture: (input, label) => {
    const id = get().capturingId;
    if (!id) return;
    set((s) => ({
        entries: s.entries.map((e) =>
            e.id === id
                ? { ...e, keyCode: input.kind === 'keyboard' ? input.code : -1, input, label, pressCount: 0 }
                : e,
        ),
        capturingId: null,
    }));
},
```

Update increment behavior:

```ts
incrementByInput: (input) => {
    set((s) => ({
        entries: s.entries.map((e) =>
            e.enabled && inputsEqual(normalizeEntryInput(e), input)
                ? { ...e, pressCount: e.pressCount + 1 }
                : e,
        ),
    }));
},
incrementByKeyCode: (keyCode) => {
    if (keyCode < 0) return;
    get().incrementByInput({ kind: 'keyboard', code: keyCode });
},
```

Update visibility:

```ts
export function isVisibleBindingEntry(entry: BindingKeyEntry): boolean {
    return entry.enabled && normalizeEntryInput(entry) !== null;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
cd app && npx vitest run src/domain/bindingKey.test.ts
```

Expected: PASS for typed input domain tests and existing binding-key tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/bindingKey.ts app/src/domain/bindingKey.test.ts
git commit -m "feat: add typed input bindings"
```

## Task 2: Typed Listener Event in Frontend

**Files:**
- Modify: `app/src/domain/bindingKey.ts`
- Test: `app/src/domain/bindingKey.test.ts`

- [ ] **Step 1: Write failing listener tests**

Add these tests inside the `useBindingKeyListener` describe block:

```ts
it('captures mouse input from input-pressed events', async () => {
    const handlers: Record<string, (e: { payload: unknown }) => void> = {};
    listenMock.mockImplementation((event: string, cb: (e: { payload: unknown }) => void) => {
        handlers[event] = cb;
        return Promise.resolve(() => {});
    });
    invokeMock.mockResolvedValue({ granted: true, platform: 'macos' });

    const { useBindingKeyListener, useBindingKeyStore } = await import('./bindingKey');
    const id = useBindingKeyStore.getState().addEntry();
    renderHook(() => useBindingKeyListener());
    await new Promise((r) => setTimeout(r, 0));

    handlers['input-pressed']({ payload: { kind: 'mouse', button: 'right' } });

    expect(useBindingKeyStore.getState().entries[0]).toEqual(expect.objectContaining({
        id,
        label: '鼠标右键',
        input: { kind: 'mouse', button: 'right' },
        pressCount: 0,
    }));
});

it('ignores malformed input-pressed payloads', async () => {
    const handlers: Record<string, (e: { payload: unknown }) => void> = {};
    listenMock.mockImplementation((event: string, cb: (e: { payload: unknown }) => void) => {
        handlers[event] = cb;
        return Promise.resolve(() => {});
    });
    invokeMock.mockResolvedValue({ granted: true, platform: 'macos' });

    const { useBindingKeyListener, useBindingKeyStore } = await import('./bindingKey');
    useBindingKeyStore.getState().addEntry();
    renderHook(() => useBindingKeyListener());
    await new Promise((r) => setTimeout(r, 0));

    handlers['input-pressed']({ payload: { kind: 'mouse', button: 'side' } });
    handlers['input-pressed']({ payload: { kind: 'keyboard', code: -1 } });

    expect(useBindingKeyStore.getState().capturingId).not.toBe(null);
    expect(useBindingKeyStore.getState().entries[0].label).toBe('未绑定');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd app && npx vitest run src/domain/bindingKey.test.ts
```

Expected: FAIL because `useBindingKeyListener` does not subscribe to `input-pressed`.

- [ ] **Step 3: Add payload guard and listener**

In `app/src/domain/bindingKey.ts`, add:

```ts
function isInputPressedEvent(value: unknown): value is InputPressedEvent {
    if (!value || typeof value !== 'object') return false;
    const payload = value as Partial<InputPressedEvent>;
    if (payload.kind === 'keyboard') {
        return Number.isInteger(payload.code) && payload.code >= 0;
    }
    if (payload.kind === 'mouse') {
        return payload.button === 'left' || payload.button === 'middle' || payload.button === 'right';
    }
    return false;
}
```

Inside `useBindingKeyListener`, add `unlistenInput` beside `unlistenKey` and subscribe:

```ts
listen<InputPressedEvent>('input-pressed', (event) => {
    if (!isInputPressedEvent(event.payload)) return;
    const store = useBindingKeyStore.getState();
    const input = event.payload;
    if (store.capturingId) {
        store.completeCapture(input, labelForInput(input, store.platform));
    } else {
        store.incrementByInput(input);
    }
}).then((un) => {
    if (cancelled) un();
    else unlistenInput = un;
}).catch(() => {});
```

Keep the legacy `key-pressed` listener as a keyboard-only fallback:

```ts
listen<number>('key-pressed', (event) => {
    const keyCode = Number(event.payload);
    if (!Number.isInteger(keyCode) || keyCode < 0) return;
    const input: BindingInput = { kind: 'keyboard', code: keyCode };
    const store = useBindingKeyStore.getState();
    if (store.capturingId) {
        store.completeCapture(input, labelForInput(input, store.platform));
    } else {
        store.incrementByInput(input);
    }
})
```

Call `unlistenInput()` in the cleanup.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
cd app && npx vitest run src/domain/bindingKey.test.ts
```

Expected: PASS for listener tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/bindingKey.ts app/src/domain/bindingKey.test.ts
git commit -m "feat: listen for typed input events"
```

## Task 3: Badge Rendering and UI Integration

**Files:**
- Create: `app/src/ui/InputBindingBadge.tsx`
- Create: `app/src/ui/InputBindingBadge.css`
- Modify: `app/src/ui/InputCounterPanel.tsx`
- Modify: `app/src/ui/InputCounterPanel.css`
- Modify: `app/src/ui/PlayerCard.tsx`
- Modify: `app/src/ui/PlayerCard.css`
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/ui/SettingsPanel.css`
- Test: `app/src/ui/InputCounterPanel.test.tsx`
- Test: `app/src/ui/PlayerCard.test.tsx`
- Test: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add to `app/src/ui/InputCounterPanel.test.tsx`:

```ts
it('renders a mouse icon badge for mouse bindings', () => {
    useBindingKeyStore.setState({
        panelEnabled: true,
        entries: [
            { id: 'mouse-left', label: '鼠标左键', keyCode: -1, input: { kind: 'mouse', button: 'left' }, pressCount: 5, enabled: true },
        ],
    });

    render(<InputCounterPanel />);

    expect(screen.getByTestId('mouse-left-icon')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
});
```

Add to `app/src/ui/PlayerCard.test.tsx`:

```ts
it('renders remote mouse binding labels as mouse icons', () => {
    render(<PlayerCard player={player(state({
        bindingKey: { keyLabel: '鼠标中键', pressCount: 4 },
    }))} />);

    expect(screen.getByTestId('mouse-middle-icon')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
});
```

Add to `app/src/ui/SettingsPanel.test.tsx`:

```ts
it('uses 添加输入 copy for the binding add button', () => {
    render(<SettingsPanel />);
    expect(screen.getByRole('button', { name: /添加输入/ })).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd app && npx vitest run src/ui/InputCounterPanel.test.tsx src/ui/PlayerCard.test.tsx src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because no shared mouse badge exists and the add button still says `添加按键`.

- [ ] **Step 3: Create shared badge component**

Create `app/src/ui/InputBindingBadge.tsx`:

```tsx
import type { BindingInput, MouseButton } from '../domain/bindingKey';
import './InputBindingBadge.css';

interface InputBindingBadgeProps {
    input?: BindingInput | null;
    label: string;
}

const MOUSE_LABEL_TO_BUTTON: Record<string, MouseButton> = {
    '鼠标左键': 'left',
    '鼠标中键': 'middle',
    '鼠标右键': 'right',
};

export function inputFromRemoteLabel(label: string): BindingInput | null {
    const button = MOUSE_LABEL_TO_BUTTON[label.trim()];
    return button ? { kind: 'mouse', button } : null;
}

export function InputBindingBadge({ input, label }: InputBindingBadgeProps) {
    const resolved = input ?? inputFromRemoteLabel(label);
    if (resolved?.kind === 'mouse') {
        return (
            <span className="input-binding-badge input-binding-badge-mouse" title={label}>
                <MouseButtonIcon button={resolved.button} />
            </span>
        );
    }
    return <span className="input-binding-badge input-binding-badge-key">{label}</span>;
}

function MouseButtonIcon({ button }: { button: MouseButton }) {
    const testId = `mouse-${button}-icon`;
    return (
        <svg data-testid={testId} className="mouse-button-icon" viewBox="0 0 256 256" aria-hidden="true">
            <rect className="mouse-icon-body" x="56" y="24" width="144" height="208" rx="68" />
            <rect className="mouse-icon-split" x="60" y="110" width="136" height="6" />
            {button === 'middle' ? (
                <>
                    <ellipse className="mouse-icon-wheel-bg" cx="128" cy="74" rx="12" ry="38" />
                    <rect className="mouse-icon-wheel-detail" x="120" y="58" width="16" height="4" />
                    <rect className="mouse-icon-wheel-detail" x="120" y="78" width="16" height="4" />
                </>
            ) : (
                <>
                    <rect className="mouse-icon-split" x="125" y="32" width="6" height="78" />
                    <ellipse className="mouse-icon-indicator" cx={button === 'left' ? 96 : 160} cy="75" rx="18" ry="25" />
                </>
            )}
        </svg>
    );
}
```

Create `app/src/ui/InputBindingBadge.css`:

```css
.input-binding-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
}

.input-binding-badge-key {
    padding: var(--pill-key-pad-y, 1px) var(--pill-key-pad-x, 4px);
    border: 1px solid var(--pill-key-stroke);
    border-radius: var(--pill-key-radius);
    background: var(--pill-key-bg);
    color: var(--pill-key-color);
    font-size: var(--pill-key-size);
    font-weight: 700;
    line-height: 1;
}

.input-binding-badge-mouse {
    width: 18px;
    height: 18px;
}

.mouse-button-icon {
    width: 18px;
    height: 18px;
    display: block;
}

.mouse-icon-body,
.mouse-icon-wheel-detail {
    fill: #5B4636;
}

.mouse-icon-split,
.mouse-icon-indicator,
.mouse-icon-wheel-bg {
    fill: #FFF3EA;
}
```

- [ ] **Step 4: Replace duplicated badge rendering**

In `InputCounterPanel.tsx`, import `InputBindingBadge` and `normalizeEntryInput`, then change `KeyCounterPill`:

```tsx
function KeyCounterPill({ entry }: { entry: BindingKeyEntry }) {
    return (
        <div className="input-counter-pill">
            <InputBindingBadge input={normalizeEntryInput(entry)} label={entry.label} />
            <span className="input-counter-key-count">{entry.pressCount}</span>
        </div>
    );
}
```

In `PlayerCard.tsx`, import `InputBindingBadge` and replace `pc-pill-key`:

```tsx
<span className="pc-pill" title={`${binding.keyLabel} × ${binding.pressCount}`}>
    <InputBindingBadge label={binding.keyLabel} />
    <span className="pc-pill-count">{binding.pressCount}</span>
</span>
```

In `SettingsPanel.tsx`, import `InputBindingBadge` and `normalizeEntryInput`, then change the listener button content:

```tsx
{bk.capturingId === entry.id ? (
    '请按下要绑定的键或鼠标按钮…'
) : (
    <>
        <InputBindingBadge input={normalizeEntryInput(entry)} label={entry.label} />
        <span className="bk-listener-label">{entry.label}</span>
    </>
)}
```

Change the add button text:

```tsx
<PlusIcon /> 添加输入
```

- [ ] **Step 5: Remove duplicated key badge CSS**

In `InputCounterPanel.css`, remove `.input-counter-key-badge` because `InputBindingBadge.css` owns that styling.

In `PlayerCard.css`, remove `.pc-pill-key` because `InputBindingBadge.css` owns badge styling.

In `SettingsPanel.css`, add:

```css
.bk-listener-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

- [ ] **Step 6: Run UI tests to verify pass**

Run:

```bash
cd app && npx vitest run src/ui/InputCounterPanel.test.tsx src/ui/PlayerCard.test.tsx src/ui/SettingsPanel.test.tsx
```

Expected: PASS for mouse badge and copy tests.

- [ ] **Step 7: Commit**

```bash
git add app/src/ui/InputBindingBadge.tsx app/src/ui/InputBindingBadge.css app/src/ui/InputCounterPanel.tsx app/src/ui/InputCounterPanel.css app/src/ui/PlayerCard.tsx app/src/ui/PlayerCard.css app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.css app/src/ui/InputCounterPanel.test.tsx app/src/ui/PlayerCard.test.tsx app/src/ui/SettingsPanel.test.tsx
git commit -m "feat: render mouse input badges"
```

## Task 4: Settings Capture and Bridge Payloads

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Test: `app/src/ui/SettingsPanel.test.tsx`
- Test: `app/src/domain/bridge/protocol.test.ts`
- Test: `app/src/domain/bridge/host.test.ts`
- Test: `app/src/domain/bridge/client.test.ts`

- [ ] **Step 1: Write failing capture and bridge tests**

In `SettingsPanel.test.tsx`, add:

```ts
it('finishes Windows mouse capture from the focused settings window', async () => {
    useBindingKeyStore.setState({
        platform: 'windows',
        entries: [{ id: 'capture', label: '未绑定', keyCode: -1, input: null, pressCount: 0, enabled: true }],
        capturingId: 'capture',
    });

    render(<SettingsPanel />);
    fireEvent.pointerDown(window, { button: 1 });

    expect(useBindingKeyStore.getState().entries[0]).toEqual(expect.objectContaining({
        label: '鼠标中键',
        input: { kind: 'mouse', button: 'middle' },
    }));
});
```

In `app/src/domain/bridge/protocol.test.ts`, change the `completeCapture` valid payload from `[32, 'Space']` to:

```ts
{ v: 1, store: 'bindingKey', action: 'completeCapture', args: [{ kind: 'keyboard', code: 32 }, 'Space'] },
```

In `host.test.ts`, update the dispatch assertion:

```ts
applyDispatch({
    v: BRIDGE_VERSION,
    store: 'bindingKey',
    action: 'completeCapture',
    args: [{ kind: 'mouse', button: 'left' }, '鼠标左键'],
});
expect(useBindingKeyStore.getState().entries[0]).toEqual(expect.objectContaining({
    input: { kind: 'mouse', button: 'left' },
    label: '鼠标左键',
}));
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts
```

Expected: FAIL because dispatch args are still numeric and settings mouse fallback is absent.

- [ ] **Step 3: Update bridge protocol and clone behavior**

In `app/src/domain/bridge/protocol.ts`, import `BindingInput` and change:

```ts
| { v: typeof BRIDGE_VERSION; store: 'bindingKey'; action: 'completeCapture'; args: [BindingInput, string] }
```

In `host.ts`, no switch shape change is needed after the type update because `b.completeCapture(...payload.args)` still applies the action. Confirm `cloneEntries` preserves the `input` field by using object spread:

```ts
function cloneEntries(entries: BindingKeyEntry[]): BindingKeyEntry[] {
    return entries.map((entry) => ({ ...entry, input: entry.input ? { ...entry.input } : entry.input }));
}
```

Apply the same clone helper shape in `client.ts`.

- [ ] **Step 4: Add Windows mouse DOM fallback**

In `SettingsPanel.tsx`, import `MOUSE_BUTTON_LABELS` and `BindingInput`. Add:

```ts
function inputForPointerButton(button: number): BindingInput | null {
    if (button === 0) return { kind: 'mouse', button: 'left' };
    if (button === 1) return { kind: 'mouse', button: 'middle' };
    if (button === 2) return { kind: 'mouse', button: 'right' };
    return null;
}
```

Extend the Windows capture effect:

```ts
const completeWindowsPointerCapture = (event: PointerEvent) => {
    const input = inputForPointerButton(event.button);
    if (!input) return;
    event.preventDefault();
    event.stopPropagation();
    useBindingKeyStore.getState().completeCapture(input, MOUSE_BUTTON_LABELS[input.button]);
};

window.addEventListener('pointerdown', completeWindowsPointerCapture, true);
return () => {
    window.removeEventListener('keydown', completeWindowsCapture, true);
    window.removeEventListener('pointerdown', completeWindowsPointerCapture, true);
};
```

Also update the existing Windows key fallback:

```ts
const input: BindingInput = { kind: 'keyboard', code: keyCode };
useBindingKeyStore.getState().completeCapture(input, labelForInput(input, 'windows'));
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts
```

Expected: PASS for capture and bridge tests.

- [ ] **Step 6: Commit**

```bash
git add app/src/ui/SettingsPanel.tsx app/src/domain/bridge/protocol.ts app/src/domain/bridge/host.ts app/src/domain/bridge/client.ts app/src/ui/SettingsPanel.test.tsx app/src/domain/bridge/protocol.test.ts app/src/domain/bridge/host.test.ts app/src/domain/bridge/client.test.ts
git commit -m "feat: bridge typed input capture"
```

## Task 5: State Sync Compatibility

**Files:**
- Modify: `app/src/domain/stateSync.ts`
- Test: `app/src/domain/stateSync.test.ts`
- Test: `Server/test/protocol.test.js`
- Test: `Server/test/integration.test.js`

- [ ] **Step 1: Write or update state sync tests**

In `stateSync.test.ts`, add:

```ts
it('syncs mouse bindings through the existing keyLabel and pressCount payload', () => {
    useBindingKeyStore.setState({
        syncedKeyId: 'mouse-left',
        entries: [
            { id: 'mouse-left', label: '鼠标左键', keyCode: -1, input: { kind: 'mouse', button: 'left' }, pressCount: 6, enabled: true },
        ],
    });

    expect(buildRemoteStateForTest().bindingKey).toEqual({
        keyLabel: '鼠标左键',
        pressCount: 6,
    });
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
cd app && npx vitest run src/domain/stateSync.test.ts
cd Server && npm test
```

Expected: app state sync test PASS after typed entries compile. Server tests PASS unchanged because the protocol still allows string `keyLabel` plus numeric `pressCount`.

- [ ] **Step 3: Update existing stateSync fixtures with typed inputs**

Update every existing `BindingKeyEntry` fixture in `stateSync.test.ts` so bound keyboard entries include the typed input that matches their `keyCode`:

```ts
{ id: 'space', label: 'Space', keyCode: 49, input: { kind: 'keyboard', code: 49 }, pressCount: 0, enabled: true }
```

Do not change `RemoteBindingKey` or `PROTOCOL_VERSION`.

- [ ] **Step 4: Commit**

```bash
git add app/src/domain/stateSync.ts app/src/domain/stateSync.test.ts Server/test/protocol.test.js Server/test/integration.test.js
git commit -m "test: cover mouse binding sync"
```

## Task 6: Rust Typed Event Payloads on macOS

**Files:**
- Modify: `app/src-tauri/src/key_counter.rs`
- Modify: `app/src-tauri/src/accessibility/mod.rs`
- Test: Rust unit tests inside `app/src-tauri/src/key_counter.rs`

- [ ] **Step 1: Write failing Rust mapping tests**

Add this test module at the bottom of `key_counter.rs`:

```rust
#[cfg(test)]
mod input_event_tests {
    use super::*;

    #[test]
    fn keyboard_payload_keeps_key_code() {
        assert_eq!(
            InputPressedPayload::keyboard(49),
            InputPressedPayload { kind: "keyboard", code: Some(49), button: None }
        );
    }

    #[test]
    fn mouse_payload_uses_button_names() {
        assert_eq!(
            InputPressedPayload::mouse("middle"),
            InputPressedPayload { kind: "mouse", code: None, button: Some("middle") }
        );
    }
}
```

- [ ] **Step 2: Run Rust tests to verify failure**

Run:

```bash
cd app/src-tauri && cargo test input_event_tests
```

Expected: FAIL because `InputPressedPayload` does not exist.

- [ ] **Step 3: Add serializable payload type**

In `key_counter.rs`, add:

```rust
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputPressedPayload {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub button: Option<&'static str>,
}

impl InputPressedPayload {
    pub fn keyboard(code: i64) -> Self {
        Self { kind: "keyboard", code: Some(code), button: None }
    }

    pub fn mouse(button: &'static str) -> Self {
        Self { kind: "mouse", code: None, button: Some(button) }
    }
}
```

Change `spawn_listener` callback bounds from `Fn(i64)` to:

```rust
F: Fn(InputPressedPayload) + Send + Sync + 'static,
```

In macOS mapping, emit:

```rust
vec![
    CGEventType::KeyDown,
    CGEventType::LeftMouseDown,
    CGEventType::RightMouseDown,
    CGEventType::OtherMouseDown,
],
move |_proxy, event_type, event: &CGEvent| -> CallbackResult {
    match event_type {
        CGEventType::KeyDown => {
            let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
            on_key(InputPressedPayload::keyboard(keycode));
        }
        CGEventType::LeftMouseDown => on_key(InputPressedPayload::mouse("left")),
        CGEventType::RightMouseDown => on_key(InputPressedPayload::mouse("right")),
        CGEventType::OtherMouseDown => {
            let button = event.get_integer_value_field(EventField::MOUSE_EVENT_BUTTON_NUMBER);
            if button == 2 {
                on_key(InputPressedPayload::mouse("middle"));
            }
        }
        _ => {}
    }
    CallbackResult::Keep
},
```

In `accessibility/mod.rs`, update emission:

```rust
let result = crate::key_counter::spawn_listener(stop.clone(), move |payload| {
    let _ = app_handle.emit("input-pressed", &payload);
    if payload.kind == "keyboard" {
        if let Some(code) = payload.code {
            let _ = app_handle.emit("key-pressed", code);
        }
    }
});
```

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cd app/src-tauri && cargo test input_event_tests
```

Expected: PASS for payload tests.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/key_counter.rs app/src-tauri/src/accessibility/mod.rs
git commit -m "feat: emit typed macos input events"
```

## Task 7: Windows Mouse Hook Lifecycle

**Files:**
- Modify: `app/src-tauri/src/key_counter.rs`
- Modify: `app/src-tauri/Cargo.toml`
- Test: Rust unit tests inside `app/src-tauri/src/key_counter.rs`

- [ ] **Step 1: Write Windows message mapping tests**

Add these tests under the Rust test module:

```rust
#[test]
fn windows_mouse_messages_map_supported_buttons() {
    assert_eq!(windows_mouse_message_to_button(0x0201), Some("left"));
    assert_eq!(windows_mouse_message_to_button(0x0207), Some("middle"));
    assert_eq!(windows_mouse_message_to_button(0x0204), Some("right"));
    assert_eq!(windows_mouse_message_to_button(0x020B), None);
}
```

- [ ] **Step 2: Run Rust tests to verify failure**

Run:

```bash
cd app/src-tauri && cargo test windows_mouse_messages_map_supported_buttons
```

Expected: FAIL because `windows_mouse_message_to_button` does not exist.

- [ ] **Step 3: Add Windows mouse hook mapping and channel**

In the Windows section of `key_counter.rs`, add imports:

```rust
use windows::Win32::UI::WindowsAndMessaging::{
    WH_MOUSE_LL, MSLLHOOKSTRUCT, WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_RBUTTONDOWN,
};
```

Add helper:

```rust
fn windows_mouse_message_to_button(message: u32) -> Option<&'static str> {
    match message {
        WM_LBUTTONDOWN => Some("left"),
        WM_MBUTTONDOWN => Some("middle"),
        WM_RBUTTONDOWN => Some("right"),
        _ => None,
    }
}
```

Change the Windows channel type from `mpsc::Sender<i64>` to `mpsc::Sender<InputPressedPayload>`. Update keyboard sends:

```rust
let _ = sender.send(InputPressedPayload::keyboard(i64::from(event.vkCode)));
```

Add a mouse hook proc that sends mouse payloads:

```rust
unsafe extern "system" fn mouse_proc(code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if code >= 0 {
        let message = w_param.0 as u32;
        if let Some(button) = windows_mouse_message_to_button(message) {
            let _event = unsafe { *(l_param.0 as *const MSLLHOOKSTRUCT) };
            if let Some(sender_slot) = KEY_SENDER.get() {
                if let Ok(sender_guard) = sender_slot.lock() {
                    if let Some(sender) = sender_guard.as_ref() {
                        let _ = sender.send(InputPressedPayload::mouse(button));
                    }
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, w_param, l_param) }
}
```

Install both hooks and fail startup if either fails:

```rust
let keyboard_hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0) };
let mouse_hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0) };
```

If mouse hook fails after keyboard hook succeeds, unhook keyboard before returning the error. During shutdown, unhook both hooks.

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cd app/src-tauri && cargo test windows_mouse_messages_map_supported_buttons
```

Expected: PASS for mapping tests.

- [ ] **Step 5: Check Windows feature flags**

Run:

```bash
cd app/src-tauri && cargo check
```

Expected: PASS on the current host for non-Windows target. If the compiler reports missing Windows types during Windows CI/build, add the exact missing Win32 feature to `app/src-tauri/Cargo.toml` under the existing `windows` dependency and rerun `cargo check`.

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/key_counter.rs app/src-tauri/Cargo.toml
git commit -m "feat: add windows mouse input hook"
```

## Task 8: Full Verification

**Files:**
- Verify the full repository state.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
cd app && npx vitest run src/domain/bindingKey.test.ts src/ui/InputCounterPanel.test.tsx src/ui/PlayerCard.test.tsx src/ui/SettingsPanel.test.tsx src/domain/stateSync.test.ts src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts
```

Expected: PASS for all listed suites.

- [ ] **Step 2: Run all app tests**

Run:

```bash
cd app && npm test
```

Expected: PASS for the full Vitest suite.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd app && npm run build
```

Expected: PASS with TypeScript and Vite build output.

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cd app/src-tauri && cargo test
```

Expected: PASS for Rust unit and integration tests.

- [ ] **Step 5: Run server tests**

Run:

```bash
cd Server && npm test
```

Expected: PASS because the server protocol remains version `1` with `{ keyLabel, pressCount }`.

- [ ] **Step 6: Manual macOS verification**

Run:

```bash
cd app && npm run tauri dev
```

Expected checks:

1. Open settings and click `添加输入`.
2. Click left mouse button while capture is active; row shows `鼠标左键` with left mouse icon.
3. Click left mouse button in another foreground app; independent input counter increments.
4. Repeat for middle and right mouse buttons.
5. Add a keyboard binding; keyboard capture and counting still work.

- [ ] **Step 7: Final commit if verification fixes were needed**

If verification required fixes, commit them:

```bash
git add app Server docs
git commit -m "fix: stabilize mouse input counter"
```

If no fixes were needed, do not create an empty commit.
