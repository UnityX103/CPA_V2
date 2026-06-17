# VZN4U Count Fields Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pencil node `VZN4U` count editing controls visually and functionally match `R8wI7`, `cwqXn`, and `fiNze`.

**Architecture:** Keep the existing `CheckinPlanEditorPanel` and `CheckinPlanItem` schema. The UI remaps the three count-state controls to the correct existing fields (`perUseAmount`, `perUseUnit`, `countLoopCount`) while keeping old count metadata fields normalized for compatibility.

**Tech Stack:** React, TypeScript, Zustand domain store, native CSS, Vitest, Testing Library.

---

## File Structure

- Modify `app/src/ui/CheckinPlanEditorPanel.test.tsx`: add red tests for the three Pencil node mappings and the count-content labels.
- Modify `app/src/ui/CheckinPlanEditorPanel.tsx`: change count-mode input labels, values, and update handlers.
- Modify `app/src/ui/CheckinPlanEditorPanel.css`: keep existing `VZN4U` geometry and add unit field text-input sizing if needed.

## Task 1: Lock The Three VZN4U Field Mappings

**Files:**
- Modify: `app/src/ui/CheckinPlanEditorPanel.test.tsx`
- Test: `app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Add a count-mode fixture**

Add this fixture after `baseTemplate`:

```ts
const countTemplate: CheckinPlanTemplate = {
    schemaVersion: 2,
    carryToNextWeek: true,
    items: [{
        id: 'pomodoro',
        title: 'Pomodoro 专注',
        type: 'pomodoroFocus',
        targetCount: 6,
        icon: 'clock',
        repeatDays: ['mon', 'tue'],
        editMode: 'count',
        perUseAmount: 25,
        perUseUnit: '分钟',
        countInputValue: 4,
        countUnitSize: 4,
        countUnitLabel: '次',
        countLoopCount: 1,
    }],
};
```

- [ ] **Step 2: Add the failing mapping tests**

Add these tests inside `describe('CheckinPlanEditorPanel', () => { ... })`:

```ts
it('maps VZN4U R8wI7 to per-use amount without changing target or loop fields', () => {
    useCheckinStore.setState({
        planTemplate: structuredClone(countTemplate),
        dailyRecords: {},
        lastError: null,
    });
    render(<CheckinPlanEditorPanel />);

    fireEvent.change(screen.getByLabelText('Pomodoro 专注 每次数量'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

    expect(useCheckinStore.getState().planTemplate.items[0]).toMatchObject({
        targetCount: 6,
        perUseAmount: 30,
        perUseUnit: '分钟',
        countUnitSize: 4,
        countLoopCount: 1,
    });
});

it('maps VZN4U cwqXn to per-use unit without changing count unit size', () => {
    useCheckinStore.setState({
        planTemplate: structuredClone(countTemplate),
        dailyRecords: {},
        lastError: null,
    });
    render(<CheckinPlanEditorPanel />);

    fireEvent.change(screen.getByLabelText('Pomodoro 专注 单位设置'), { target: { value: '页' } });
    fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

    expect(useCheckinStore.getState().planTemplate.items[0]).toMatchObject({
        perUseAmount: 25,
        perUseUnit: '页',
        countUnitSize: 4,
        countLoopCount: 1,
    });
});

it('maps VZN4U fiNze to loop count without changing per-use amount or unit', () => {
    useCheckinStore.setState({
        planTemplate: structuredClone(countTemplate),
        dailyRecords: {},
        lastError: null,
    });
    render(<CheckinPlanEditorPanel />);

    fireEvent.change(screen.getByLabelText('Pomodoro 专注 循环次数'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

    expect(useCheckinStore.getState().planTemplate.items[0]).toMatchObject({
        perUseAmount: 25,
        perUseUnit: '分钟',
        countLoopCount: 3,
    });
});
```

- [ ] **Step 3: Run the focused mapping tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx -t "VZN4U"
```

Expected: FAIL because the current UI has labels `输入值` / `每轮次数`, writes `countInputValue` / `countUnitSize`, and does not expose `Pomodoro 专注 每次数量` or `Pomodoro 专注 单位设置`.

## Task 2: Implement The Pencil Field Mapping

**Files:**
- Modify: `app/src/ui/CheckinPlanEditorPanel.tsx`
- Modify: `app/src/ui/CheckinPlanEditorPanel.css`
- Test: `app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Add small fallback helpers**

In `app/src/ui/CheckinPlanEditorPanel.tsx`, add these helpers after `itemColor`:

```ts
function countPerUseAmount(item: CheckinPlanItem): number {
    return item.perUseAmount ?? item.countInputValue ?? 1;
}

function countPerUseUnit(item: CheckinPlanItem): string {
    return item.perUseUnit ?? item.countUnitLabel ?? '次';
}

function countLoopCount(item: CheckinPlanItem): number {
    return item.countLoopCount ?? 1;
}
```

- [ ] **Step 2: Replace the count-mode controls**

In the `isCountMode ? (...)` branch, replace the three labels with:

```tsx
<label className="checkin-editor-field">
    <span>每次数量</span>
    <input
        aria-label={`${item.title} 每次数量`}
        type="number"
        min={0}
        value={countPerUseAmount(item)}
        onChange={(event) => updateItem(item.id, { perUseAmount: Number(event.target.value) })}
    />
</label>
<label className="checkin-editor-field checkin-editor-unit-field">
    <span>单位</span>
    <input
        aria-label={`${item.title} 单位设置`}
        value={countPerUseUnit(item)}
        onChange={(event) => updateItem(item.id, { perUseUnit: event.target.value })}
    />
</label>
<label className="checkin-editor-field">
    <span>循环次数</span>
    <input
        aria-label={`${item.title} 循环次数`}
        type="number"
        min={1}
        value={countLoopCount(item)}
        onChange={(event) => updateItem(item.id, { countLoopCount: Number(event.target.value) })}
    />
</label>
```

- [ ] **Step 3: Keep unit input visually aligned**

In `app/src/ui/CheckinPlanEditorPanel.css`, after the existing `.checkin-editor-count-grid .checkin-editor-field input` rule, add:

```css
.checkin-editor-count-grid .checkin-editor-unit-field input {
    text-align: left;
}
```

- [ ] **Step 4: Run focused mapping tests and verify they pass**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx -t "VZN4U"
```

Expected: PASS.

## Task 3: Verify And Commit

**Files:**
- Verify: `app/src/ui/CheckinPlanEditorPanel.tsx`
- Verify: `app/src/ui/CheckinPlanEditorPanel.css`
- Verify: `app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Run focused UI tests**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx
```

Expected: all tests in `CheckinPlanEditorPanel.test.tsx` pass.

- [ ] **Step 2: Run build**

Run:

```bash
cd app && npm run build
```

Expected: `tsc && vite build` exits 0.

- [ ] **Step 3: Run full app tests**

Run:

```bash
cd app && npm test
```

Expected: all app tests pass.

- [ ] **Step 4: Check final status**

Run:

```bash
git status --short
git diff -- app/src/ui/CheckinPlanEditorPanel.tsx app/src/ui/CheckinPlanEditorPanel.css app/src/ui/CheckinPlanEditorPanel.test.tsx
```

Expected: only the VZN4U UI/test changes are unstaged, and the protected pre-existing `AUI/PUI.pen` remains unstaged.

- [ ] **Step 5: Commit implementation**

Run:

```bash
git add app/src/ui/CheckinPlanEditorPanel.tsx app/src/ui/CheckinPlanEditorPanel.css app/src/ui/CheckinPlanEditorPanel.test.tsx docs/superpowers/plans/2026-06-17-vzn4u-count-fields-audit.md
git commit -m "fix: audit VZN4U count field mappings"
```

Expected: commit includes only this plan and the VZN4U UI/test fix.
