# Check-in Editor Pixel Sync and Icon Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pixel-sync the full check-in editor panel to Pencil node `s6g1w`, replace item color dots with selectable icons, make item metrics editable, and enforce a single Pomodoro item per day.

**Architecture:** Treat Pencil as the source of truth, sync the static HTML/dev-align prototype first, then import the verified structure and styles into the React app. Keep behavior in the existing check-in domain/editor draft flow and keep generated icons as currentColor SVG assets rendered by a small glyph component.

**Tech Stack:** Pencil MCP, React, TypeScript, Vitest, Testing Library, native CSS, Vite dev-align route.

---

## File Structure

- Modify `/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/PUI.pen`: update current-worktree Pencil node `s6g1w`, replacing item dot `W0QrF` with an icon glyph and preserving the metric node `YVc3O` visual frame.
- Modify `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/domain/checkin.ts`: keep `CheckinItemIcon`, `icon`, `perUseAmount`, and `perUseUnit` types on check-in items.
- Modify `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/domain/checkinPersistence.ts`: validate icon and metric persistence.
- Modify `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/ui/checkinItemIcons.ts`: keep the generated icon registry and default icon resolver.
- Modify `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/ui/CheckinItemIconGlyph.tsx`: render check-in icon SVGs with currentColor.
- Modify `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/ui/CheckinPlanEditorPanel.tsx`: implement pixel-synced editor structure, editable rows, icon picker, and Pomodoro uniqueness.
- Modify `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/ui/CheckinPlanEditorPanel.css`: match Pencil spacing, typography, frames, date selector, add module, row layout, and icon picker.
- Modify `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/ui/CheckinPlanEditorPanel.test.tsx`: cover item editing, icon picking, metric editing, save/cancel, and Pomodoro uniqueness.
- Modify `/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/desk-window-next/components/CheckinPlanEditorPanel.tsx`: sync the static HTML prototype before importing into app React.
- Modify `/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/desk-window-next/app/page.tsx`: keep the static prototype reachable for comparison.
- Modify `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/DevAlignApp.tsx`: keep the `s6g1w-html` dev-align target pointed at the updated Pencil export and React render.
- Replace `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/public/dev-align/s6g1w.png`: refreshed Pencil export after the Pencil edit.

## Task 1: Update Pencil Design and Export Baseline

**Files:**
- Modify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/PUI.pen`
- Replace: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/public/dev-align/s6g1w.png`

- [ ] **Step 1: Open the current-worktree Pencil file**

Run through Pencil MCP:

```ts
open_document({
  path: "/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/PUI.pen"
})
```

Expected: Pencil opens the current worktree file even if the active editor previously pointed at another worktree.

- [ ] **Step 2: Read the panel and reference icons**

Run through Pencil MCP:

```ts
batch_get({
  filePath: "/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/PUI.pen",
  nodeIds: ["s6g1w", "W0QrF", "YVc3O", "YIVxx/GOGW7", "YIVxx/o9i6o1", "YIVxx/AlRGc"],
  readDepth: 3,
  resolveVariables: true
})
```

Expected: `s6g1w` is present, `W0QrF` is the item dot position, `YVc3O` is the "每次" metric frame, and the three `YIVxx/*` nodes resolve as thin lucide-style icons.

- [ ] **Step 3: Replace the dot with a style-matched icon in Pencil**

Run through Pencil MCP:

```ts
batch_design({
  filePath: "/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/PUI.pen",
  input: `
R("W0QrF",{type:"icon_font",iconFontFamily:"lucide",iconFontName:"book-open",width:14,height:14,fill:"#E08C10"})
`
})
```

Expected: the "阅读" row uses a compact thin-stroke icon where the 10px dot used to be. If Pencil rejects replacing an ellipse with `icon_font`, insert a sibling `icon_font` at the same row position and delete `W0QrF`.

- [ ] **Step 4: Export the updated baseline**

Run through Pencil MCP:

```ts
export_nodes({
  filePath: "/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/PUI.pen",
  nodeIds: ["s6g1w"],
  outputDir: "/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/public/dev-align",
  format: "png",
  scale: 2
})
```

Expected: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/public/dev-align/s6g1w.png` exists and contains the updated icon in the item row.

## Task 2: Write Failing UI Tests for Required Behavior

**Files:**
- Modify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Add tests for icon picking, metric editing, row editing, and Pomodoro uniqueness**

Add these tests to the existing `CheckinPlanEditorPanel` suite, adapting only the helper names to the current test file:

```tsx
import { fireEvent, screen, within } from '@testing-library/react';

it('disables adding another Pomodoro item when the selected day already has one', () => {
  renderEditorWithPlan({
    tue: {
      kind: 'items',
      items: [
        { id: 'focus', title: '专注番茄', type: 'pomodoroFocus', targetCount: 2, icon: 'clock' },
      ],
    },
  });

  fireEvent.click(screen.getByRole('button', { name: '新增栏目' }));

  const pomodoroChoice = screen.getByRole('button', { name: /番茄钟/ });
  expect(pomodoroChoice).toBeDisabled();
});

it('edits an item icon through the row icon picker', () => {
  const onSave = vi.fn();
  renderEditorWithPlan(
    {
      tue: {
        kind: 'items',
        items: [
          { id: 'read', title: '阅读', type: 'manual', targetCount: 2, icon: 'bookOpen' },
        ],
      },
    },
    { onSave },
  );

  fireEvent.click(screen.getByRole('button', { name: '更换 阅读 图标' }));
  fireEvent.click(screen.getByRole('button', { name: '咖啡' }));
  fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      days: expect.objectContaining({
        tue: expect.objectContaining({
          items: [expect.objectContaining({ id: 'read', icon: 'coffee' })],
        }),
      }),
    }),
  );
});

it('edits the per-use metric represented by Pencil node YVc3O', () => {
  const onSave = vi.fn();
  renderEditorWithPlan(
    {
      tue: {
        kind: 'items',
        items: [
          {
            id: 'read',
            title: '阅读',
            type: 'manual',
            targetCount: 2,
            icon: 'bookOpen',
            perUseAmount: 30,
            perUseUnit: '分钟',
          },
        ],
      },
    },
    { onSave },
  );

  fireEvent.change(screen.getByLabelText('阅读 每次数量'), { target: { value: '45' } });
  fireEvent.change(screen.getByLabelText('阅读 每次单位'), { target: { value: '页' } });
  fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      days: expect.objectContaining({
        tue: expect.objectContaining({
          items: [
            expect.objectContaining({
              id: 'read',
              perUseAmount: 45,
              perUseUnit: '页',
            }),
          ],
        }),
      }),
    }),
  );
});

it('keeps edits in the draft until save and discards them on cancel', () => {
  const onSave = vi.fn();
  renderEditorWithPlan(
    {
      tue: {
        kind: 'items',
        items: [
          { id: 'water', title: '喝水', type: 'manual', targetCount: 10, icon: 'droplet' },
        ],
      },
    },
    { onSave },
  );

  fireEvent.change(screen.getByLabelText('喝水 标题'), { target: { value: '补水' } });
  fireEvent.change(screen.getByLabelText('补水 每日目标'), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));

  expect(onSave).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue('补水')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests and verify they fail for the missing behavior**

Run:

```bash
cd /Users/xpy/.codex/worktrees/5ace/CPA_V2/app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx
```

Expected: FAIL because the current panel does not fully expose the requested accessible controls and Pomodoro-disabled add state.

## Task 3: Normalize Item Icon and Metric Data

**Files:**
- Modify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/domain/checkin.ts`
- Modify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/domain/checkinPersistence.ts`
- Modify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/domain/checkinPersistence.test.ts`

- [ ] **Step 1: Add persistence tests for icons and metrics**

Add:

```ts
it('preserves valid item icon and per-use metric fields', () => {
  const snapshot = parsePersistedCheckinSnapshot({
    schemaVersion: 1,
    weeklyPlan: {
      weekStartDate: '2026-05-18',
      carryToNextWeek: true,
      days: {
        mon: {
          kind: 'items',
          items: [
            {
              id: 'read',
              title: '阅读',
              type: 'manual',
              targetCount: 2,
              icon: 'bookOpen',
              perUseAmount: 30,
              perUseUnit: '分钟',
            },
          ],
        },
      },
    },
    dailyRecords: {},
  });

  expect(snapshot.weeklyPlan.days.mon).toEqual({
    kind: 'items',
    items: [
      expect.objectContaining({
        icon: 'bookOpen',
        perUseAmount: 30,
        perUseUnit: '分钟',
      }),
    ],
  });
});

it('drops unknown icon keys and clamps invalid metric values', () => {
  const snapshot = parsePersistedCheckinSnapshot({
    schemaVersion: 1,
    weeklyPlan: {
      weekStartDate: '2026-05-18',
      carryToNextWeek: true,
      days: {
        tue: {
          kind: 'items',
          items: [
            {
              id: 'bad',
              title: '坏数据',
              type: 'manual',
              targetCount: 1,
              icon: 'unknownIcon',
              perUseAmount: -5,
              perUseUnit: '',
            },
          ],
        },
      },
    },
    dailyRecords: {},
  });

  const item = snapshot.weeklyPlan.days.tue.kind === 'items'
    ? snapshot.weeklyPlan.days.tue.items[0]
    : undefined;
  expect(item).toMatchObject({ perUseAmount: 0, perUseUnit: '次' });
  expect(item).not.toHaveProperty('icon');
});
```

- [ ] **Step 2: Run persistence tests and verify failure**

Run:

```bash
cd /Users/xpy/.codex/worktrees/5ace/CPA_V2/app && npx vitest run src/domain/checkinPersistence.test.ts
```

Expected: FAIL if icon or metric normalization is incomplete.

- [ ] **Step 3: Implement the normalization helper**

In `checkinPersistence.ts`, ensure the parser uses this shape:

```ts
import { CHECKIN_ITEM_ICON_KEYS, type CheckinItemIcon } from '../ui/checkinItemIcons';

const validIconKeys = new Set<string>(CHECKIN_ITEM_ICON_KEYS);

function normalizeIcon(value: unknown): CheckinItemIcon | undefined {
  return typeof value === 'string' && validIconKeys.has(value)
    ? (value as CheckinItemIcon)
    : undefined;
}

function normalizePerUseAmount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

function normalizePerUseUnit(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '次';
}
```

Expected: valid icon/metric data survives load; invalid icon values are removed.

## Task 4: Sync Static HTML Prototype to Pencil

**Files:**
- Modify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/desk-window-next/components/CheckinPlanEditorPanel.tsx`
- Modify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/AUI/desk-window-next/app/page.tsx`

- [ ] **Step 1: Structure the prototype to match Pencil sections**

Set the component top-level order to:

```tsx
export function CheckinPlanEditorPanel() {
  return (
    <section className="checkin-editor-panel" aria-label="本周计划">
      <Header />
      <WeekSelector />
      <SelectedDayCard />
      <DayContentCard />
      <AdvancedRow />
      <ApplyRow />
    </section>
  );
}
```

Expected: the static DOM order matches `N4Xz7`, `mCWPj`, `B3Lqo`, `vyLe0`, `TqJ88`, `lPZdc`.

- [ ] **Step 2: Use the two-row date selector**

Implement:

```tsx
const weekRows = [
  ['一', '二', '三', '四'],
  ['五', '六', '日'],
];
```

Expected: the date selector no longer renders as a 7-column single row.

- [ ] **Step 3: Render item rows with icons and metric frames**

Each row in the prototype should use:

```tsx
<button className="checkin-item-icon-button" aria-label={`更换 ${item.title} 图标`}>
  <CheckinItemIconGlyph icon={item.icon} />
</button>
<input className="checkin-item-title-input" aria-label={`${item.title} 标题`} value={item.title} readOnly />
<label className="checkin-item-metric" aria-label={`${item.title} 每次`}>
  <span>每次</span>
  <span>
    <input aria-label={`${item.title} 每次数量`} value={item.perUseAmount} readOnly />
    <input aria-label={`${item.title} 每次单位`} value={item.perUseUnit} readOnly />
  </span>
</label>
```

Expected: the static prototype visually matches the edited Pencil row while preserving the same accessible names that app tests use.

## Task 5: Import Pixel-Synced Structure into React

**Files:**
- Modify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/ui/CheckinPlanEditorPanel.tsx`
- Modify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/ui/CheckinPlanEditorPanel.css`
- Modify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/ui/CheckinItemIconGlyph.tsx`
- Modify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/ui/checkinItemIcons.ts`

- [ ] **Step 1: Add icon registry labels**

Make the icon registry expose stable labels:

```ts
export const CHECKIN_ITEM_ICON_OPTIONS = [
  { key: 'activity', label: '活力' },
  { key: 'dumbbell', label: '运动' },
  { key: 'bookOpen', label: '阅读' },
  { key: 'droplet', label: '喝水' },
  { key: 'listChecks', label: '清单' },
  { key: 'sparkle', label: '星光' },
  { key: 'coffee', label: '咖啡' },
  { key: 'moon', label: '月亮' },
  { key: 'sun', label: '太阳' },
  { key: 'leaf', label: '叶子' },
  { key: 'music', label: '音乐' },
  { key: 'pencil', label: '书写' },
  { key: 'target', label: '目标' },
  { key: 'flame', label: '火焰' },
  { key: 'heart', label: '爱' },
  { key: 'apple', label: '苹果' },
  { key: 'clock', label: '时钟' },
  { key: 'meditation', label: '冥想' },
] as const;
```

Expected: tests can click the picker by visible label.

- [ ] **Step 2: Normalize editor draft item updates**

Use one updater so every row edit stays local until save:

```ts
function updateDraftItem(itemId: string, patch: Partial<EditableCheckinItem>) {
  setDraftPlan((plan) => updateSelectedDayItems(plan, selectedDay, (items) =>
    items.map((item) => item.id === itemId ? { ...item, ...patch } : item)
  ));
}
```

Expected: icon, title, metric, unit, and target edits all mutate only the draft.

- [ ] **Step 3: Disable Pomodoro choice when one exists**

Use:

```tsx
const hasPomodoroItem = selectedItems.some((item) => item.type === 'pomodoroFocus');

<button
  type="button"
  className="checkin-editor-type-option"
  disabled={hasPomodoroItem}
  aria-disabled={hasPomodoroItem}
  onClick={() => addItem('pomodoroFocus')}
>
  番茄钟
</button>
```

Expected: "番茄钟" is visibly unavailable once the selected day already has a Pomodoro item.

- [ ] **Step 4: Add the row icon picker**

Use:

```tsx
{openIconPickerFor === item.id ? (
  <div className="checkin-icon-picker" role="menu" aria-label={`${item.title} 图标选择`}>
    {CHECKIN_ITEM_ICON_OPTIONS.map((option) => (
      <button
        key={option.key}
        type="button"
        role="menuitem"
        aria-label={option.label}
        onClick={() => {
          updateDraftItem(item.id, { icon: option.key });
          setOpenIconPickerFor(null);
        }}
      >
        <CheckinItemIconGlyph icon={option.key} />
      </button>
    ))}
  </div>
) : null}
```

Expected: clicking an item icon opens a compact picker and choosing an option updates that row.

- [ ] **Step 5: Style the panel to match Pencil**

Apply these critical CSS values:

```css
.checkin-editor-panel {
  width: 460px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border: 1px solid #efdccd;
  border-radius: 24px;
  background: rgba(255, 253, 251, 0.93);
  overflow: hidden;
  font-family: MaokenAssortedSans, system-ui, sans-serif;
}

.checkin-editor-week-card,
.checkin-editor-day-card {
  padding: 12px;
  border: 1px solid #efdccd;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
}

.checkin-editor-week-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.checkin-editor-week-row {
  display: flex;
  gap: 8px;
}

.checkin-item-row {
  min-height: 78px;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 14px;
  background: rgba(255, 253, 251, 0.9);
}

.checkin-item-icon-button {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  color: var(--checkin-item-color);
  background: transparent;
  border: 0;
  padding: 0;
}

.checkin-item-metric {
  width: 86px;
  padding: 6px 8px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
}
```

Expected: the date selector and add-item module match the Pencil image before fine tuning.

## Task 6: Verify Tests, Build, and Pixels

**Files:**
- Verify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/ui/CheckinPlanEditorPanel.test.tsx`
- Verify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/src/domain/checkinPersistence.test.ts`
- Verify: `/Users/xpy/.codex/worktrees/5ace/CPA_V2/app/public/dev-align/s6g1w.png`

- [ ] **Step 1: Run focused tests**

Run:

```bash
cd /Users/xpy/.codex/worktrees/5ace/CPA_V2/app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx src/domain/checkinPersistence.test.ts
```

Expected: PASS for all icon, metric, uniqueness, save, and cancel cases.

- [ ] **Step 2: Run the app build**

Run:

```bash
cd /Users/xpy/.codex/worktrees/5ace/CPA_V2/app && npm run build
```

Expected: PASS with TypeScript and Vite completing successfully.

- [ ] **Step 3: Start or reuse the dev server**

Run:

```bash
lsof -ti tcp:1420 || (cd /Users/xpy/.codex/worktrees/5ace/CPA_V2/app && npm run dev -- --host 127.0.0.1 --port 1420)
```

Expected: a Vite server is available at `http://127.0.0.1:1420`.

- [ ] **Step 4: Open the dev-align target in the in-app browser**

Use the Browser plugin to open:

```text
http://127.0.0.1:1420/?window=devalign&target=s6g1w-html
```

Expected: left pane shows the updated Pencil export and right pane shows the React editor panel.

- [ ] **Step 5: Perform visual comparison**

Check these areas against the Pencil baseline:

```text
Outer panel width, padding, radius, and translucent fill
Header title, subtitle, and status pill
Two-row date selector layout
Selected day card and rest toggle
Day content header and plan badge
Add-item module shape, icon, copy, and type choices
Each item row icon, title, subtitle, metric frame, target frame, and drag icon
Advanced carry-forward row
Cancel and save buttons
```

Expected: no visible mismatch remains in the date selector or add-item module, and row icon/metric controls stay aligned with the edited Pencil design.

## Self-Review

- Spec coverage: Pencil edit, HTML-first sync, React import, item editability, `YVc3O` metric editing, `W0QrF` icon replacement, icon picker, Pomodoro uniqueness, tests, build, and browser visual verification are covered.
- Completion-marker scan: no unresolved requirement markers are present.
- Type consistency: plan uses `CheckinItemIcon`, `icon`, `perUseAmount`, and `perUseUnit` consistently with the design spec.
- Default execution choice: because the user delegated Superpowers choices to defaults, execute with `superpowers:subagent-driven-development` when implementation starts.
