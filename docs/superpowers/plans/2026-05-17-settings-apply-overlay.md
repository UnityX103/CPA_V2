# Settings Apply Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the Settings `应用` button a reusable floating overlay that appears only when the active settings section has pending ordinary changes and never affects section auto layout.

**Architecture:** Update `AUI/PUI.pen` first so `SettingsApplyRow` remains the visual source of truth. In React, lift ordinary Apply metadata from `PomodoroTab` into `SettingsPanel`, render one shared `SettingsApplyRow` overlay in `.settings-content`, and remove the tab-level `has-apply` layout padding.

**Tech Stack:** Pencil MCP for `.pen` edits, React 19 + TypeScript, Zustand stores, Vitest + Testing Library, native CSS.

---

## File Structure

- Modify: `AUI/PUI.pen`
  - Update `SettingsApplyRow` (`EOrsv`) / `uspApply` (`EkvuW`) visual sizing so the floating row has vertical breathing room.
- Modify: `app/src/ui/SettingsPanel.tsx`
  - Add a shared `SettingsApplyRow` component.
  - Add active-tab ordinary apply state in `SettingsPanel`.
  - Convert `PomodoroTab` to report `{ dirty, canApply, apply }` instead of rendering its own Apply row.
- Modify: `app/src/ui/SettingsPanel.css`
  - Keep `.apply-row` absolute and outside layout.
  - Hide it when inactive.
  - Increase row height/padding.
  - Remove `.tab-pane.has-apply` layout reservation.
- Modify: `app/src/ui/SettingsPanel.test.tsx`
  - Update existing Apply tests for hidden/visible overlay behavior.
  - Add CSS guards for no layout reservation.

## Task 1: Update Pencil Apply Overlay

**Files:**
- Modify: `AUI/PUI.pen`

- [x] **Step 1: Inspect the current Pencil nodes**

Run:

```text
mcp__pencil__batch_get({
  filePath: "/Users/xpy/Desktop/NanZhai/CPA_V2/AUI/PUI.pen",
  nodeIds: ["EOrsv", "vnYnS", "EkvuW"],
  readDepth: 3,
  resolveVariables: true
})
```

Expected: `EOrsv` is reusable `SettingsApplyRow`; `EkvuW` is the `uspApply` instance under `vnYnS/content`, absolute positioned.

- [x] **Step 2: Update the overlay row sizing**

Apply this Pencil update:

```text
U("EOrsv",{height:54,padding:[8,16],alignItems:"center",justifyContent:"end",width:"fill_container"})
U("EkvuW",{height:54,alignItems:"center",justifyContent:"end",fill:"#ffffffff"})
```

Expected: The row remains a reusable overlay with a 120 x 38 primary button and has 8px top/bottom breathing room.

- [x] **Step 3: Verify Pencil layout structurally**

Run:

```text
mcp__pencil__batch_get({
  filePath: "/Users/xpy/Desktop/NanZhai/CPA_V2/AUI/PUI.pen",
  nodeIds: ["EOrsv", "vnYnS"],
  readDepth: 3,
  resolveVariables: true
})
```

Expected: `EOrsv.height` is `54`, `EOrsv.padding` is `[8,16]`, and `EkvuW.layoutPosition` remains `absolute`.

## Task 2: Write Failing UI Tests

**Files:**
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [x] **Step 1: Replace the old disabled-by-default Apply test**

Find the existing test named:

```ts
it('enables Apply when 自动开始休息 changes', () => {
```

Replace it with:

```ts
it('hides the ordinary Apply overlay until a Pomodoro setting changes', () => {
    render(<SettingsPanel />);

    expect(screen.queryByRole('button', { name: '应用' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '自动开始休息' }));

    const apply = screen.getByRole('button', { name: '应用' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
});
```

- [x] **Step 2: Add Apply-hides-after-commit test**

Add this test in `describe('PomodoroTab parity with gs1Tv', ...)` after the visibility test:

```ts
it('hides the ordinary Apply overlay after applying Pomodoro changes', () => {
    render(<SettingsPanel />);

    fireEvent.click(screen.getByRole('button', { name: '自动开始休息' }));
    fireEvent.click(screen.getByRole('button', { name: '应用' }));

    expect(usePomodoroStore.getState().autoStartBreak).toBe(true);
    expect(screen.queryByRole('button', { name: '应用' })).toBeNull();
});
```

- [x] **Step 3: Keep invalid dirty state visible but disabled**

Update the existing custom-video test so it still expects a disabled Apply button after choosing `custom`:

```ts
fireEvent.change(screen.getByLabelText('视频选项'), { target: { value: 'custom' } });
const apply = screen.getByRole('button', { name: '应用' });
expect(apply).toHaveProperty('disabled', true);
```

Expected: No change to this assertion; it documents the dirty-but-invalid state.

- [x] **Step 4: Add CSS guard for no layout reservation**

Add this test in `describe('SettingsPanel geometry', ...)`:

```ts
it('ordinary Apply is an overlay and does not reserve tab layout space', () => {
    const css = readFileSync(path.join(here, 'SettingsPanel.css'), 'utf8');
    const row = cssRule(css, '.apply-row');
    const hidden = cssRule(css, '.apply-row.hidden');

    expect(row).toMatch(/position:\s*absolute\s*;/);
    expect(row).toMatch(/height:\s*54px\s*;/);
    expect(row).toMatch(/padding:\s*8px\s+16px\s*;/);
    expect(hidden).toMatch(/display:\s*none\s*;/);
    expect(css).not.toMatch(/\.tab-pane\.has-apply\s*\{/);
});
```

- [x] **Step 5: Run focused tests and confirm failure**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because `PomodoroTab` still renders Apply directly and `.tab-pane.has-apply` still exists.

## Task 3: Implement Shared Apply Overlay

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`

- [x] **Step 1: Add ordinary apply state types**

Add below `TABS`:

```ts
interface OrdinaryApplyState {
    dirty: boolean;
    canApply: boolean;
    apply: () => void;
}

const EMPTY_APPLY_STATE: OrdinaryApplyState = {
    dirty: false,
    canApply: false,
    apply: () => {},
};
```

- [x] **Step 2: Add shared `SettingsApplyRow` component**

Add before `PomodoroTab`:

```tsx
function SettingsApplyRow({ visible, enabled, onApply }: {
    visible: boolean;
    enabled: boolean;
    onApply: () => void;
}) {
    return (
        <div className={`apply-row ${visible ? '' : 'hidden'}`} aria-hidden={!visible}>
            {visible && (
                <button className="btn btn-primary apply-btn" disabled={!enabled} onClick={onApply}>
                    应用
                </button>
            )}
        </div>
    );
}
```

- [x] **Step 3: Store active ordinary apply state in `SettingsPanel`**

Inside `SettingsPanel`, add:

```ts
const [ordinaryApply, setOrdinaryApply] = useState<OrdinaryApplyState>(EMPTY_APPLY_STATE);

useEffect(() => {
    setOrdinaryApply(EMPTY_APPLY_STATE);
}, [activeTab]);
```

- [x] **Step 4: Render one shared overlay in `.settings-content`**

Replace active tab rendering with:

```tsx
<div className="settings-content">
    {activeTab === 'pomodoro' && <PomodoroTab onApplyStateChange={setOrdinaryApply} />}
    {activeTab === 'online' && <OnlineTab />}
    {activeTab === 'pet' && <PetTab />}
    {activeTab === 'global' && <GlobalTab />}
    <SettingsApplyRow
        visible={ordinaryApply.dirty}
        enabled={ordinaryApply.canApply}
        onApply={ordinaryApply.apply}
    />
</div>
```

- [x] **Step 5: Change `PomodoroTab` signature**

Replace:

```ts
function PomodoroTab() {
```

with:

```ts
function PomodoroTab({ onApplyStateChange }: {
    onApplyStateChange: (state: OrdinaryApplyState) => void;
}) {
```

- [x] **Step 6: Report Pomodoro dirty/apply state upward**

After `apply` is declared, add:

```ts
useEffect(() => {
    onApplyStateChange({
        dirty,
        canApply,
        apply,
    });
}, [onApplyStateChange, dirty, canApply, apply]);
```

If TypeScript reports that `apply` changes every render and causes effect churn, wrap it with `useCallback` using the exact dependencies it reads:

```ts
const apply = useCallback(() => {
    if (!canApply) return;
    const focusSeconds = focusMin * 60;
    const breakSeconds = breakMin * 60;
    const durationChanged =
        focusSeconds !== pomo.focusDurationSeconds ||
        breakSeconds !== pomo.breakDurationSeconds ||
        autoStartBreak !== pomo.autoStartBreak;
    const endActionChanged =
        endActionMode !== pomo.endActionMode ||
        !sameEndActionVideo(endActionVideo, pomo.endActionVideo);

    if (durationChanged) {
        pomo.applySettings(focusSeconds, breakSeconds, pomo.totalRounds, true, autoStartBreak);
    }
    if (endActionChanged) {
        pomo.applyEndActionSettings(endActionMode, endActionVideo);
    }
}, [canApply, focusMin, breakMin, autoStartBreak, endActionMode, endActionVideo, pomo]);
```

Also update the React import to include `useCallback`.

- [x] **Step 7: Remove tab-local Apply markup and layout class**

Remove this block from `PomodoroTab`:

```tsx
<div className="apply-row">
    <button className="btn btn-primary apply-btn" disabled={!canApply} onClick={apply}>
        应用
    </button>
</div>
```

Change:

```tsx
<div className="tab-pane has-apply">
```

to:

```tsx
<div className="tab-pane">
```

- [x] **Step 8: Run focused tests**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: CSS guard still fails until CSS is updated; component behavior tests pass or fail only on CSS class expectations.

## Task 4: Update CSS Overlay Layout

**Files:**
- Modify: `app/src/ui/SettingsPanel.css`

- [x] **Step 1: Update `.apply-row`**

Replace the existing `.apply-row`, `.apply-row .btn`, `.apply-btn`, and `.tab-pane.has-apply` block with:

```css
/* ----- SettingsApplyRow EOrsv / uspApply EkvuW: absolute overlay, no layout reservation ----- */
.apply-row {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    height: 54px;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    background: var(--settings-bg);
    z-index: 2;
    pointer-events: none;
    box-sizing: border-box;
}

.apply-row.hidden {
    display: none;
}

.apply-row .btn { pointer-events: auto; }

.apply-btn {
    width: 120px;
    height: 38px;
    font-size: 14px;
}
```

- [x] **Step 2: Update narrow-width override**

At the bottom media query, keep only:

```css
.apply-row {
    padding: 8px 0;
}
```

Do not add content padding for Apply.

- [x] **Step 3: Run focused tests**

Run:

```bash
cd app && npx vitest run src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

## Task 5: Full Verification And Commit

**Files:**
- Verify all modified files.

- [x] **Step 1: Run app tests**

Run:

```bash
cd app && npm test
```

Expected: 20 test files pass.

- [x] **Step 2: Run frontend build**

Run:

```bash
cd app && npm run build
```

Expected: `tsc && vite build` completes successfully.

- [x] **Step 3: Run Rust check**

Run:

```bash
cd app/src-tauri && PATH=/Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH /Users/xpy/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo check
```

Expected: Cargo finishes the `dev` profile without errors.

- [x] **Step 4: Inspect Git diff**

Run:

```bash
git diff -- app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.css app/src/ui/SettingsPanel.test.tsx docs/superpowers/plans/2026-05-17-settings-apply-overlay.md
```

Expected: Diff is scoped to the shared Apply overlay implementation and the plan.

- [x] **Step 5: Commit implementation**

Run:

```bash
git add AUI/PUI.pen app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.css app/src/ui/SettingsPanel.test.tsx docs/superpowers/plans/2026-05-17-settings-apply-overlay.md
git commit -m "feat: make settings apply action an overlay"
```

Expected: Commit succeeds.

## Self-Review

- Spec coverage: Pencil update is covered in Task 1; hidden/no-layout Apply behavior is covered in Tasks 2-4; Global dangerous dialog separation is preserved by only wiring ordinary Pomodoro Apply state; verification is covered in Task 5.
- Placeholder scan: no placeholder steps remain.
- Type consistency: `OrdinaryApplyState`, `SettingsApplyRow`, `dirty`, `canApply`, and `apply` names are consistent across tasks.
