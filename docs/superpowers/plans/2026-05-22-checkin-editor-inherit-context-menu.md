# Check-in Editor Inherit Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make check-in plan item deletion a right-click context-menu action, make the existing `Cpdxm` row affordance control item order, and make inherited empty-day plans explicit in the editor UI and Pencil design.

**Architecture:** Keep `CheckinDayPlan.kind === 'inherit'` as the only persisted inheritance state. Add panel-local state for row menus and inheritance acknowledgement, while continuing to save only through the existing draft `WeeklyCheckinPlan`. Update Pencil by adding an inherited-state instance and a context-menu variant near `s6g1w`.

**Tech Stack:** React, TypeScript, Zustand, Vitest, Testing Library, native CSS, Pencil MCP.

---

## File Structure

- `app/src/ui/CheckinPlanEditorPanel.tsx`: Add inherit UI branch, row context-menu state, right-click delete, and item reorder handlers.
- `app/src/ui/CheckinPlanEditorPanel.css`: Style inherited empty state, row context menu, and order menu.
- `app/src/ui/CheckinPlanEditorPanel.test.tsx`: Add focused tests for inheritance, right-click delete, and order controls.
- `AUI/PUI.pen`: Add visual variants for inherited state and right-click delete menu.
- `docs/superpowers/specs/2026-05-22-checkin-editor-inherit-context-menu-design.md`: Already created and committed as the source design.

## Task 1: Inheritance Tests

**Files:**
- Modify: `app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Add tests for inherited and empty-day behavior**

Insert these tests after `rest toggle replaces item editor with rest state until switched off`:

```tsx
it('shows the inherited state for an inherited selected day', () => {
    render(<CheckinPlanEditorPanel initialSelectedDay="tue" />);

    expect(screen.getByText('已继承前一天计划')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '基于前一天计划' })).toBeInTheDocument();
    expect(screen.queryByLabelText('阅读 标题')).not.toBeInTheDocument();
});

it('turns an empty item day into an inherited day when using the previous-day plan button', () => {
    useCheckinStore.setState({
        weeklyPlan: {
            ...structuredClone(basePlan),
            days: {
                ...structuredClone(basePlan.days),
                wed: { kind: 'items', items: [] },
            },
        },
    });
    render(<CheckinPlanEditorPanel initialSelectedDay="wed" />);

    fireEvent.click(screen.getByRole('button', { name: '基于前一天计划' }));
    fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

    expect(useCheckinStore.getState().weeklyPlan.days.wed).toEqual({ kind: 'inherit' });
});

it('adding a column from an inherited day creates an independent item day', () => {
    render(<CheckinPlanEditorPanel initialSelectedDay="tue" />);

    fireEvent.click(screen.getByRole('button', { name: '新增栏目' }));
    fireEvent.click(screen.getByRole('button', { name: /通用/ }));
    fireEvent.change(screen.getByLabelText('新栏目名称'), { target: { value: '拉伸' } });
    fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

    const tuesday = useCheckinStore.getState().weeklyPlan.days.tue;
    expect(tuesday.kind).toBe('items');
    if (tuesday.kind === 'items') {
        expect(tuesday.items).toEqual([
            expect.objectContaining({ title: '拉伸', type: 'manual' }),
        ]);
    }
});
```

- [ ] **Step 2: Run the inheritance tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx -t "inherited|previous-day|independent"
```

Expected: FAIL because inherited days currently render the ordinary empty item area and `基于前一天计划` does not exist.

## Task 2: Inheritance UI Implementation

**Files:**
- Modify: `app/src/ui/CheckinPlanEditorPanel.tsx`
- Modify: `app/src/ui/CheckinPlanEditorPanel.css`

- [ ] **Step 1: Add menu cleanup and inherit helpers**

In `CheckinPlanEditorPanel.tsx`, add this state near the existing `useState` calls:

```tsx
const [acknowledgedInheritedDays, setAcknowledgedInheritedDays] = useState<Set<WeekdayKey>>(() => new Set());
```

Add these helpers near `setSelectedPlan`:

```tsx
const closeTransientMenus = () => {
    setOpenIconPickerFor(null);
};

const inheritSelectedDay = () => {
    closeTransientMenus();
    setAcknowledgedInheritedDays((current) => new Set(current).add(selectedDay));
    setSelectedPlan({ kind: 'inherit' });
    setIsChoosingNewType(false);
};

const beginAddItem = () => {
    closeTransientMenus();
    if (selectedPlan.kind === 'inherit') {
        setSelectedPlan(emptyItemsPlan());
    }
    setIsChoosingNewType(true);
};
```

Update the `新增栏目` button to call `beginAddItem`.

- [ ] **Step 2: Make `addItem` work after changing an inherited day**

Replace `addItem` with this implementation:

```tsx
const addItem = (type: CheckinItemType) => {
    const currentPlan = draft.days[selectedDay];
    const currentItems = currentPlan.kind === 'items' ? currentPlan.items : [];
    if (type === 'pomodoroFocus' && currentItems.some((item) => item.type === 'pomodoroFocus')) return;
    setSelectedPlan({ kind: 'items', items: [...currentItems, createItem(type)] });
    setAcknowledgedInheritedDays((current) => {
        const next = new Set(current);
        next.delete(selectedDay);
        return next;
    });
    setIsChoosingNewType(false);
};
```

Update `hasPomodoroItem` to use `selectedItems` as it already does after `selectedPlan` recalculates.

- [ ] **Step 3: Add inherited and empty item states in the render**

Inside the non-rest branch of `checkin-editor-items-section`, replace the current `selectedItems.length === 0 ? ... : selectedItems.map(...)` block with a branch that renders:

```tsx
{selectedPlan.kind === 'inherit' ? (
    <div className="checkin-editor-inherit-state">
        <span>已继承前一天计划</span>
        <p>今天会显示最近一个普通计划日的打卡项目。</p>
        <button type="button" className="checkin-editor-primary" onClick={inheritSelectedDay}>
            基于前一天计划
        </button>
    </div>
) : selectedItems.length === 0 ? (
    <div className="checkin-editor-empty">
        <span>还没有当天专属项目</span>
        <button type="button" className="checkin-editor-primary" onClick={inheritSelectedDay}>
            基于前一天计划
        </button>
    </div>
) : selectedItems.map((item) => {
    /* keep the existing item row rendering here */
})}
```

Also update the plan badge content for inherited days to `已继承前一天` instead of `计划日`.

- [ ] **Step 4: Style the inherited empty state**

Add this CSS near `.checkin-editor-empty`:

```css
.checkin-editor-inherit-state {
    min-height: 139px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 18px;
    border: 1px solid #f0d3bc;
    border-radius: 16px;
    background: #fff7f0;
    color: #8b6f5c;
    text-align: center;
}

.checkin-editor-inherit-state span,
.checkin-editor-empty span {
    color: #5b4636;
    font-size: 14px;
    font-weight: 800;
}

.checkin-editor-inherit-state p {
    max-width: 280px;
    margin: 0;
    color: #6b7280;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.35;
}
```

- [ ] **Step 5: Run the inheritance tests**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx -t "inherited|previous-day|independent"
```

Expected: PASS.

- [ ] **Step 6: Commit inheritance UI**

Run:

```bash
git add app/src/ui/CheckinPlanEditorPanel.tsx app/src/ui/CheckinPlanEditorPanel.css app/src/ui/CheckinPlanEditorPanel.test.tsx
git commit -m "feat: clarify inherited checkin plans"
```

## Task 3: Row Menu and Ordering Tests

**Files:**
- Modify: `app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Add a helper plan with multiple items**

Add this helper after `resetCheckinStore`:

```tsx
function setMultiItemMonday() {
    useCheckinStore.setState({
        weeklyPlan: {
            ...structuredClone(basePlan),
            days: {
                ...structuredClone(basePlan.days),
                mon: {
                    kind: 'items',
                    items: [
                        { id: 'read', title: '阅读', type: 'manual', targetCount: 2, icon: 'bookOpen', perUseAmount: 30, perUseUnit: '分钟' },
                        { id: 'water', title: '喝水', type: 'manual', targetCount: 3, icon: 'droplet', perUseAmount: 1, perUseUnit: '杯' },
                    ],
                },
            },
        },
    });
}
```

- [ ] **Step 2: Add context-menu delete and ordering tests**

Insert these tests before the native drag tests:

```tsx
it('opens a row context menu and deletes only after choosing delete', () => {
    setMultiItemMonday();
    render(<CheckinPlanEditorPanel />);

    fireEvent.contextMenu(screen.getByTestId('checkin-item-row-read'));
    expect(screen.getByRole('menuitem', { name: '删除栏目' })).toBeInTheDocument();

    let monday = useCheckinStore.getState().weeklyPlan.days.mon;
    expect(monday.kind).toBe('items');
    if (monday.kind === 'items') {
        expect(monday.items.map((item) => item.id)).toEqual(['read', 'water']);
    }

    fireEvent.click(screen.getByRole('menuitem', { name: '删除栏目' }));
    fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

    monday = useCheckinStore.getState().weeklyPlan.days.mon;
    expect(monday.kind).toBe('items');
    if (monday.kind === 'items') {
        expect(monday.items.map((item) => item.id)).toEqual(['water']);
    }
});

it('uses the right-side grip to reorder rows instead of deleting them', () => {
    setMultiItemMonday();
    render(<CheckinPlanEditorPanel />);

    fireEvent.click(screen.getByRole('button', { name: '调整 喝水 顺序' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '上移' }));
    fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

    const monday = useCheckinStore.getState().weeklyPlan.days.mon;
    expect(monday.kind).toBe('items');
    if (monday.kind === 'items') {
        expect(monday.items.map((item) => item.id)).toEqual(['water', 'read']);
    }
});

it('closes row menus when switching days', () => {
    setMultiItemMonday();
    render(<CheckinPlanEditorPanel />);

    fireEvent.contextMenu(screen.getByTestId('checkin-item-row-read'));
    expect(screen.getByRole('menuitem', { name: '删除栏目' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '周二' }));

    expect(screen.queryByRole('menuitem', { name: '删除栏目' })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run row interaction tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx -t "context menu|grip|row menus"
```

Expected: FAIL because item rows have no test ids, no context menu, and the right-side grip still deletes.

## Task 4: Row Menu and Ordering Implementation

**Files:**
- Modify: `app/src/ui/CheckinPlanEditorPanel.tsx`
- Modify: `app/src/ui/CheckinPlanEditorPanel.css`

- [ ] **Step 1: Add row menu state and helpers**

In `CheckinPlanEditorPanel.tsx`, add this type above the component:

```tsx
type RowMenuState = { itemId: string; kind: 'context' | 'order' } | null;
```

Add this state near the existing component state:

```tsx
const [rowMenu, setRowMenu] = useState<RowMenuState>(null);
```

Update `closeTransientMenus` to:

```tsx
const closeTransientMenus = () => {
    setOpenIconPickerFor(null);
    setRowMenu(null);
};
```

- [ ] **Step 2: Add reorder helper**

Add this helper near `removeItem`:

```tsx
const moveItem = (id: string, direction: -1 | 1) => {
    const currentPlan = draft.days[selectedDay];
    if (currentPlan.kind !== 'items') return;
    const index = currentPlan.items.findIndex((item) => item.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= currentPlan.items.length) return;
    const items = [...currentPlan.items];
    const [item] = items.splice(index, 1);
    items.splice(nextIndex, 0, item);
    setSelectedPlan({ kind: 'items', items });
    setRowMenu(null);
};
```

Update `removeItem` to call `setRowMenu(null)` before or after setting the plan.

- [ ] **Step 3: Replace the row action button**

In each item row:

- Add `data-testid={`checkin-item-row-${item.id}`}`.
- Add an `onContextMenu` handler:

```tsx
onContextMenu={(event) => {
    event.preventDefault();
    setOpenIconPickerFor(null);
    setRowMenu({ itemId: item.id, kind: 'context' });
}}
```

Replace the current delete button with:

```tsx
<button
    type="button"
    className="checkin-editor-row-action"
    aria-label={`调整 ${item.title} 顺序`}
    onClick={() => {
        setOpenIconPickerFor(null);
        setRowMenu((current) => (
            current?.itemId === item.id && current.kind === 'order'
                ? null
                : { itemId: item.id, kind: 'order' }
        ));
    }}
>
    ⋮⋮
</button>
```

Render the menu inside the row after the action button:

```tsx
{rowMenu?.itemId === item.id ? (
    <div className="checkin-row-menu" role="menu">
        {rowMenu.kind === 'order' ? (
            <>
                <button type="button" role="menuitem" onClick={() => moveItem(item.id, -1)}>上移</button>
                <button type="button" role="menuitem" onClick={() => moveItem(item.id, 1)}>下移</button>
            </>
        ) : (
            <button type="button" role="menuitem" onClick={() => removeItem(item.id)}>删除栏目</button>
        )}
    </div>
) : null}
```

- [ ] **Step 4: Close row menus from existing transitions**

Call `closeTransientMenus()` in these places before applying the operation:

- Day pill `onClick`
- `toggleRestDay`
- `toggleCarryToNextWeek`
- `closeWindow`
- `savePlan`
- `beginAddItem`
- `inheritSelectedDay`

- [ ] **Step 5: Style the row menu**

Add this CSS near `.checkin-editor-row-action`:

```css
.checkin-row-menu {
    position: absolute;
    z-index: 6;
    top: 36px;
    right: 8px;
    min-width: 86px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    border: 1px solid #efdccd;
    border-radius: 12px;
    background: #fffdfb;
    box-shadow: 0 12px 24px rgba(91, 70, 54, 0.16);
}

.checkin-row-menu button {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    padding: 5px 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #5b4636;
    font-family: inherit;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
}

.checkin-row-menu button:hover {
    background: #fff1ee;
    color: #d15f3d;
}
```

- [ ] **Step 6: Run row interaction tests**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx -t "context menu|grip|row menus"
```

Expected: PASS.

- [ ] **Step 7: Commit row interactions**

Run:

```bash
git add app/src/ui/CheckinPlanEditorPanel.tsx app/src/ui/CheckinPlanEditorPanel.css app/src/ui/CheckinPlanEditorPanel.test.tsx
git commit -m "feat: add checkin row context menu"
```

## Task 5: Pencil Design Update

**Files:**
- Modify via Pencil MCP: `AUI/PUI.pen`

- [ ] **Step 1: Read the current design nodes**

Use Pencil MCP to read:

```text
nodeIds: ["s6g1w", "Cpdxm", "EPCaA"]
readDepth: 4
```

Expected: `s6g1w` contains the default plan editor, `Cpdxm` is the grip icon, and `EPCaA` is the rest-state instance.

- [ ] **Step 2: Add inherited-state instance**

Copy `s6g1w` to the right of `EPCaA` and name it `Check-in Plan Editor Panel / Inherited State Instance`.

Override copy in that instance:

- Title: `本周计划 · 继承变体`
- Status: `INHERIT STATE`
- Selected day title: `周二计划 · 已继承前一天`
- Selected day description: `当天使用最近一个普通计划日的打卡项目`
- Day-content badge: `已继承前一天`
- Day-content body: `已继承前一天计划`
- Empty-state button: `基于前一天计划`

Use existing fills from `s6g1w`, with the orange inherited state palette matching the default editor.

- [ ] **Step 3: Add right-click menu visual near an item row**

Inside or next to the inherited/default instance, add a small menu frame near an item row:

- Name: `item-row/context-menu-delete`
- Fill: `#FFFDFB`
- Stroke: `#EFDCCD`
- Text: `删除栏目`
- Text fill: `#D15F3D`

Place it close enough to the row to show that it appears from right-click, but do not cover the row text or metric cells.

- [ ] **Step 4: Verify the design screenshot**

Use Pencil MCP screenshot for the new inherited-state instance.

Expected: inherited-state panel is readable, context menu is visible, and no controls overlap.

## Task 6: Full Verification

**Files:**
- Verify: `app/src/ui/CheckinPlanEditorPanel.test.tsx`
- Verify: `AUI/PUI.pen`

- [ ] **Step 1: Run the full panel test file**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the full app test suite**

Run:

```bash
cd app && npm test
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd app && npm run build
```

Expected: PASS.

- [ ] **Step 4: Review git status**

Run:

```bash
git status --short
```

Expected: only intended changes remain in `app/src/ui/CheckinPlanEditorPanel.tsx`, `app/src/ui/CheckinPlanEditorPanel.css`, `app/src/ui/CheckinPlanEditorPanel.test.tsx`, `AUI/PUI.pen`, and this plan if it has not already been committed.

- [ ] **Step 5: Commit final implementation**

Run:

```bash
git add app/src/ui/CheckinPlanEditorPanel.tsx app/src/ui/CheckinPlanEditorPanel.css app/src/ui/CheckinPlanEditorPanel.test.tsx AUI/PUI.pen docs/superpowers/plans/2026-05-22-checkin-editor-inherit-context-menu.md
git commit -m "feat: refine checkin plan item editing"
```

Expected: commit succeeds after tests and build pass.
