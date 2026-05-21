# Check-in Editor Panel Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the check-in plan editor window draggable from non-interactive panel areas while preserving all editor controls.

**Architecture:** Reuse the app's existing root-level panel drag pattern. `CheckinPlanEditorPanel` will call `getCurrentWindow().startDragging()` only when `shouldStartWindowDrag` accepts the pointer target, which keeps button, input, select, and marked no-drag regions interactive.

**Tech Stack:** React, TypeScript, Tauri JavaScript APIs, Vitest, Testing Library.

---

## File Structure

- Modify `app/src/ui/CheckinPlanEditorPanel.tsx`: add the native drag pointer handler to the editor panel root.
- Modify `app/src/ui/CheckinPlanEditorPanel.test.tsx`: mock the Tauri window API and add drag behavior coverage.
- No CSS, Rust, capability, or window-builder changes are needed.

### Task 1: Add Failing Drag Tests

**Files:**
- Modify: `app/src/ui/CheckinPlanEditorPanel.test.tsx`
- Test: `app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Mock the Tauri window API**

At the top of `app/src/ui/CheckinPlanEditorPanel.test.tsx`, replace the current hoisted mock block:

```ts
const { invokeMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
}));
```

with:

```ts
const { invokeMock, startDraggingMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    startDraggingMock: vi.fn(),
}));
```

Then add this mock below the existing `@tauri-apps/api/core` mock:

```ts
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        startDragging: () => {
            startDraggingMock();
            return Promise.resolve();
        },
    }),
}));
```

- [ ] **Step 2: Reset the drag mock before each test**

In the `beforeEach` block, add:

```ts
startDraggingMock.mockReset();
```

The full block should be:

```ts
beforeEach(() => {
    invokeMock.mockReset();
    startDraggingMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    resetCheckinStore();
});
```

- [ ] **Step 3: Add behavior tests**

Append these tests inside `describe('CheckinPlanEditorPanel', () => { ... })`:

```ts
it('starts native drag from the editor background', () => {
    render(<CheckinPlanEditorPanel />);

    fireEvent.pointerDown(screen.getByTestId('checkin-plan-editor-panel'), { button: 0 });

    expect(startDraggingMock).toHaveBeenCalledTimes(1);
});

it('does not start native drag from non-primary pointer buttons', () => {
    render(<CheckinPlanEditorPanel />);

    fireEvent.pointerDown(screen.getByTestId('checkin-plan-editor-panel'), { button: 2 });

    expect(startDraggingMock).not.toHaveBeenCalled();
});

it('does not start native drag from editor buttons', () => {
    render(<CheckinPlanEditorPanel />);

    fireEvent.pointerDown(screen.getByRole('button', { name: '新增栏目' }), { button: 0 });

    expect(startDraggingMock).not.toHaveBeenCalled();
});

it('does not start native drag from editor inputs or selects', () => {
    render(<CheckinPlanEditorPanel />);

    fireEvent.pointerDown(screen.getByLabelText('阅读 名称'), { button: 0 });
    fireEvent.pointerDown(screen.getByLabelText('阅读 类型'), { button: 0 });

    expect(startDraggingMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run the focused test and verify it fails**

Run:

```bash
cd app
npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx
```

Expected: the new background drag test fails because `startDraggingMock` is not called.

### Task 2: Implement Editor Panel Drag

**Files:**
- Modify: `app/src/ui/CheckinPlanEditorPanel.tsx`
- Test: `app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Add imports**

At the top of `app/src/ui/CheckinPlanEditorPanel.tsx`, change:

```ts
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
```

to:

```ts
import type { PointerEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
```

Then add:

```ts
import { shouldStartWindowDrag } from './windowDrag';
```

above the CSS import.

- [ ] **Step 2: Add the pointer handler**

Inside `CheckinPlanEditorPanel`, add this function after `savePlan`:

```ts
const onPanelPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!shouldStartWindowDrag(e.button, e.target)) return;
    void getCurrentWindow().startDragging().catch(() => {
        /* drag may fail outside the Tauri runtime */
    });
};
```

- [ ] **Step 3: Attach the handler to the root element**

Change the root JSX from:

```tsx
<div className="checkin-editor-panel" data-testid="checkin-plan-editor-panel">
```

to:

```tsx
<div
    className="checkin-editor-panel"
    data-testid="checkin-plan-editor-panel"
    onPointerDown={onPanelPointerDown}
>
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd app
npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx
```

Expected: all tests in `CheckinPlanEditorPanel.test.tsx` pass.

### Task 3: Verify and Commit

**Files:**
- Verify: `app/src/ui/CheckinPlanEditorPanel.tsx`
- Verify: `app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Run the full frontend test suite**

Run:

```bash
cd app
npm test
```

Expected: Vitest exits successfully.

- [ ] **Step 2: Review the final diff**

Run:

```bash
git diff -- app/src/ui/CheckinPlanEditorPanel.tsx app/src/ui/CheckinPlanEditorPanel.test.tsx
```

Expected: the diff only adds the editor panel drag handler and focused drag tests.

- [ ] **Step 3: Commit the implementation**

Run:

```bash
git add app/src/ui/CheckinPlanEditorPanel.tsx app/src/ui/CheckinPlanEditorPanel.test.tsx docs/superpowers/plans/2026-05-21-checkin-editor-panel-drag.md
git commit -m "fix: make checkin editor panel draggable"
```

Expected: git creates a commit containing the plan and implementation.

## Self-Review

- Spec coverage: the plan implements root-level non-interactive dragging, protects controls through `shouldStartWindowDrag`, avoids native/Rust changes, and adds tests for primary button, non-primary button, buttons, inputs, and selects.
- Placeholder scan: the plan contains no deferred sections or undefined tasks.
- Type consistency: the implementation uses `PointerEvent<HTMLDivElement>`, `getCurrentWindow().startDragging()`, and the existing `shouldStartWindowDrag(button, target)` signature.
