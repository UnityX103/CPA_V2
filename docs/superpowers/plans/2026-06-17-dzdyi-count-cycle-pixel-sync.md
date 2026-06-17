# DzDyI Count/Cycle Pixel Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pixel-sync the `DzDyI` check-in editor row count-editing state with the cycle-editing state and Pencil geometry.

**Architecture:** Keep `CheckinPlanEditorPanel` as the only component involved. The fix is CSS-first: both states keep the same shared item row and top area; only `.checkin-editor-item-controls` swaps between cycle controls and count controls. Tests lock the easy-to-regress Pencil geometry constants.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, native CSS.

---

## File Structure

- Modify `app/src/ui/CheckinPlanEditorPanel.test.tsx`: add a CSS geometry contract test for `DzDyI` state parity.
- Modify `app/src/ui/CheckinPlanEditorPanel.css`: update count-state controls to use the shared horizontal controls contract and Pencil widths.

## Task 1: Lock DzDyI State Geometry

**Files:**
- Modify: `app/src/ui/CheckinPlanEditorPanel.test.tsx`
- Test: `app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Write the failing CSS geometry test**

Add this import near the other imports:

```ts
import { readFileSync } from 'node:fs';
```

Add this helper after `resetCheckinStore()`:

```ts
function editorCss(): string {
    return readFileSync(new URL('./CheckinPlanEditorPanel.css', import.meta.url), 'utf8');
}
```

Add this test inside `describe('CheckinPlanEditorPanel', () => { ... })`:

```ts
it('keeps DzDyI count and cycle controls on the same shared row geometry', () => {
    const css = editorCss();

    expect(css).toMatch(/\.checkin-editor-cycle-select\s*\{[^}]*width:\s*94px;[^}]*height:\s*31px;/s);
    expect(css).toMatch(/\.checkin-editor-repeat-controls\s*\{[^}]*gap:\s*8px;/s);
    expect(css).toMatch(/\.checkin-editor-repeat-days\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*5px;/s);

    expect(css).toMatch(/\.checkin-editor-count-grid\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*6px;/s);
    expect(css).toMatch(/\.checkin-editor-count-grid\s+\.checkin-editor-field:nth-child\(1\)\s*\{[^}]*width:\s*75px;/s);
    expect(css).toMatch(/\.checkin-editor-count-grid\s+\.checkin-editor-field:nth-child\(2\)\s*\{[^}]*width:\s*96px;/s);
    expect(css).toMatch(/\.checkin-editor-count-grid\s+\.checkin-editor-field:nth-child\(3\)\s*\{[^}]*width:\s*112px;/s);
    expect(css).toMatch(/\.checkin-editor-count-grid\s+\.checkin-editor-field\s*\{[^}]*height:\s*36px;[^}]*border-radius:\s*12px;/s);
    expect(css).toMatch(/\.checkin-editor-count-grid\s+\.checkin-editor-field:last-child\s*\{[^}]*border-color:\s*#efdccd;[^}]*background:\s*#fff7f0;/s);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx -t "DzDyI count and cycle controls"
```

Expected: FAIL because `.checkin-editor-count-grid` still uses grid layout and its second column is `92px`, not `96px`.

## Task 2: Sync Count-State CSS To Pencil

**Files:**
- Modify: `app/src/ui/CheckinPlanEditorPanel.css`
- Test: `app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Replace the final count-grid geometry block**

In `app/src/ui/CheckinPlanEditorPanel.css`, replace the final `.checkin-editor-count-grid` rule near the bottom:

```css
.checkin-editor-count-grid {
    display: grid;
    grid-template-columns: 75px 92px 112px;
    gap: 6px;
}
```

with:

```css
.checkin-editor-count-grid {
    display: flex;
    align-items: center;
    gap: 6px;
}

.checkin-editor-count-grid .checkin-editor-field:nth-child(1) {
    width: 75px;
}

.checkin-editor-count-grid .checkin-editor-field:nth-child(2) {
    width: 96px;
}

.checkin-editor-count-grid .checkin-editor-field:nth-child(3) {
    width: 112px;
}
```

- [ ] **Step 2: Keep count fields fixed-width inside the shared controls row**

In the existing final `.checkin-editor-count-grid .checkin-editor-field` rule, make sure it includes `flex: 0 0 auto;`:

```css
.checkin-editor-count-grid .checkin-editor-field {
    min-width: 0;
    height: 36px;
    box-sizing: border-box;
    flex: 0 0 auto;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    background: #ffffffcc;
}
```

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx -t "DzDyI count and cycle controls"
```

Expected: PASS.

## Task 3: Verify And Commit

**Files:**
- Verify: `app/src/ui/CheckinPlanEditorPanel.test.tsx`
- Verify: `app/src/ui/CheckinPlanEditorPanel.css`

- [ ] **Step 1: Run focused UI tests**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx
```

Expected: all tests in `CheckinPlanEditorPanel.test.tsx` pass.

- [ ] **Step 2: Run the build**

Run:

```bash
cd app && npm run build
```

Expected: `tsc && vite build` exits 0.

- [ ] **Step 3: Check the final diff**

Run:

```bash
git status --short
git diff -- app/src/ui/CheckinPlanEditorPanel.css app/src/ui/CheckinPlanEditorPanel.test.tsx
```

Expected: only the CSS geometry fix and the focused test are changed, plus the protected pre-existing `AUI/PUI.pen` remains unstaged.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add app/src/ui/CheckinPlanEditorPanel.css app/src/ui/CheckinPlanEditorPanel.test.tsx docs/superpowers/plans/2026-06-17-dzdyi-count-cycle-pixel-sync.md
git commit -m "fix: sync DzDyI count and cycle states"
```

Expected: commit includes only this plan and the UI sync files.
