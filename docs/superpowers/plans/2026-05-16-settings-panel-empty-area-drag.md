# Settings Panel Empty Area Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the settings window to start native window dragging from non-interactive empty areas inside the settings panel while preserving all existing button and input interactions.

**Architecture:** Add one local DOM-target classifier in `SettingsPanel.tsx`, then route all settings panel pointer-down events through a single root handler. Keep the Tauri `startDragging()` call in the React layer and avoid changes to Rust window lifecycle, passthrough hooks, or visual layout.

**Tech Stack:** React 19, TypeScript, Tauri v2 JavaScript API, Vitest, Testing Library.

---

## File Structure

- Modify: `app/src/ui/SettingsPanel.tsx`
  - Owns the settings dialog markup and settings-window drag behavior.
  - Add `isInteractiveDragTarget()` near the top of the file so it stays local to this component.
  - Replace the header-only drag handler with a panel-level handler that uses the classifier.
- Modify: `app/src/ui/SettingsPanel.test.tsx`
  - Owns settings panel interaction and geometry regression tests.
  - Extend the existing `SettingsPanel drag` describe block with empty-area and interactive-target coverage.

No CSS, Rust, bridge protocol, or store files should change.

## Task 1: Add Failing Drag Coverage

**Files:**
- Modify: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Add tests for content empty area drag and interactive target suppression**

In `app/src/ui/SettingsPanel.test.tsx`, inside `describe('SettingsPanel drag', () => { ... })`, after the existing close-button test, add these tests:

```tsx
    it('content empty area pointer down triggers native window drag', async () => {
        render(<SettingsPanel />);
        const content = screen.getByRole('dialog', { name: '设置' }).querySelector('.settings-content')!;
        await act(async () => {
            fireEvent.pointerDown(content, { button: 0 });
        });
        expect(startDragging).toHaveBeenCalledTimes(1);
    });

    it('right-clicking empty content does NOT trigger drag', async () => {
        render(<SettingsPanel />);
        const content = screen.getByRole('dialog', { name: '设置' }).querySelector('.settings-content')!;
        await act(async () => {
            fireEvent.pointerDown(content, { button: 2 });
        });
        expect(startDragging).not.toHaveBeenCalled();
    });

    it('clicking a settings tab does NOT trigger drag', async () => {
        render(<SettingsPanel />);
        const tab = screen.getByRole('button', { name: '联机' });
        await act(async () => {
            fireEvent.pointerDown(tab, { button: 0 });
        });
        expect(startDragging).not.toHaveBeenCalled();
    });

    it('clicking an input does NOT trigger drag', async () => {
        render(<SettingsPanel />);
        const input = screen.getAllByRole('spinbutton')[0];
        await act(async () => {
            fireEvent.pointerDown(input, { button: 0 });
        });
        expect(startDragging).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run the focused test and confirm the new empty-area test fails**

Run:

```bash
cd app
npm test -- SettingsPanel.test.tsx
```

Expected: `content empty area pointer down triggers native window drag` fails because `.settings-content` has no pointer-down drag handler yet. Existing tests should still pass.

- [ ] **Step 3: Commit the failing tests only**

Run:

```bash
git add app/src/ui/SettingsPanel.test.tsx
git commit -m "test: cover settings empty-area drag"
```

Expected: commit succeeds with only `SettingsPanel.test.tsx` staged.

## Task 2: Implement Panel-Level Drag Handling

**Files:**
- Modify: `app/src/ui/SettingsPanel.tsx`
- Test: `app/src/ui/SettingsPanel.test.tsx`

- [ ] **Step 1: Add the local interactive target classifier**

In `app/src/ui/SettingsPanel.tsx`, below the `TABS` constant and above `export function SettingsPanel()`, add:

```tsx
const NO_WINDOW_DRAG_SELECTOR = [
    'button',
    'input',
    'select',
    'textarea',
    'a',
    '[role="button"]',
    '[data-no-window-drag]',
].join(',');

function isInteractiveDragTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return true;
    return target.closest(NO_WINDOW_DRAG_SELECTOR) !== null;
}
```

- [ ] **Step 2: Replace the header-only drag handler with a panel-level handler**

In `SettingsPanel`, replace the existing `onHeaderPointerDown` function:

```tsx
    const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        void getCurrentWindow().startDragging().catch(() => {
            /* drag may fail in non-Tauri/test env; swallow */
        });
    };
```

with:

```tsx
    const onPanelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        if (isInteractiveDragTarget(e.target)) return;
        void getCurrentWindow().startDragging().catch(() => {
            /* drag may fail in non-Tauri/test env; swallow */
        });
    };
```

- [ ] **Step 3: Bind the handler to the settings panel root and remove the header binding**

In the returned JSX, change the root panel from:

```tsx
        <div
            className="settings-panel"
            role="dialog"
            aria-label="设置"
        >
            <div className="settings-head" onPointerDown={onHeaderPointerDown}>
```

to:

```tsx
        <div
            className="settings-panel"
            role="dialog"
            aria-label="设置"
            onPointerDown={onPanelPointerDown}
        >
            <div className="settings-head">
```

- [ ] **Step 4: Run the focused settings panel test**

Run:

```bash
cd app
npm test -- SettingsPanel.test.tsx
```

Expected: all tests in `SettingsPanel.test.tsx` pass, including the new empty-area drag and interactive-target tests.

- [ ] **Step 5: Run the front-end test suite**

Run:

```bash
cd app
npm test
```

Expected: the full Vitest suite passes.

- [ ] **Step 6: Commit the implementation**

Run:

```bash
git add app/src/ui/SettingsPanel.tsx app/src/ui/SettingsPanel.test.tsx
git commit -m "fix: drag settings window from empty panel areas"
```

Expected: commit succeeds with only the settings panel implementation and tests staged.

## Self-Review

- Spec coverage: Task 1 covers the user-visible regression and interaction boundaries; Task 2 implements the shared helper, root handler, left-button guard, interaction suppression, and error swallowing.
- Placeholder scan: This plan has no `TBD`, `TODO`, or unspecified implementation steps.
- Type consistency: The plan defines `isInteractiveDragTarget(target: EventTarget | null): boolean`, `NO_WINDOW_DRAG_SELECTOR`, and `onPanelPointerDown(e: React.PointerEvent<HTMLDivElement>)` once and uses those exact names throughout.
