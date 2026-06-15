# Check-in Item Repeat Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old day-owned check-in plan with an item-owned repeat template that matches Pencil `g9Gei/s6g1w`.

**Architecture:** `app/src/domain/checkin.ts` becomes the source of truth for `CheckinPlanTemplate`. Persistence, user preferences, cloud data, and bridge snapshots carry `planTemplate` while accepting legacy `weeklyPlan` snapshots. `CheckinPlanEditorPanel` edits item rows with repeat-day pills and a cycle/count mode toggle; `TodayCheckinPanel` renders effective items or a no-plan state.

**Tech Stack:** React, TypeScript, Zustand, Vitest, Testing Library, native CSS.

---

### Task 1: Domain Model And Legacy Migration

**Files:**
- Modify: `app/src/domain/checkin.ts`
- Test: `app/src/domain/checkin.test.ts`

- [ ] **Step 1: Write failing domain tests**

Add tests that express the new API:

```ts
it('filters template items by repeat days for a date', () => {
    const store = createCheckinStore({ isMirrorWindow: false });
    store.setState({
        planTemplate: {
            schemaVersion: 2,
            carryToNextWeek: true,
            items: [
                { id: 'read', title: '阅读', type: 'manual', targetCount: 2, repeatDays: ['mon', 'wed'], editMode: 'cycle' },
                { id: 'water', title: '喝水', type: 'manual', targetCount: 3, repeatDays: ['tue'], editMode: 'cycle' },
            ],
        },
        dailyRecords: {},
        lastError: null,
    });

    expect(itemsForDate(store.getState(), '2026-05-18').map((item) => item.id)).toEqual(['read']);
    expect(itemsForDate(store.getState(), '2026-05-19').map((item) => item.id)).toEqual(['water']);
    expect(itemsForDate(store.getState(), '2026-05-20').map((item) => item.id)).toEqual(['read']);
});

it('treats no-plan days as complete without rest-day semantics', () => {
    const store = createCheckinStore({ isMirrorWindow: false });
    store.setState({
        planTemplate: {
            schemaVersion: 2,
            carryToNextWeek: true,
            items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2, repeatDays: ['mon'], editMode: 'cycle' }],
        },
        dailyRecords: {},
        lastError: null,
    });

    expect(itemsForDate(store.getState(), '2026-05-19')).toEqual([]);
    expect(dailySummary(store.getState(), '2026-05-19')).toMatchObject({
        date: '2026-05-19',
        isNoPlanDay: true,
        completedCount: 0,
        totalTarget: 0,
        completionRate: 1,
    });
});

it('migrates legacy weekly plans into repeated template items', () => {
    const migrated = migrateWeeklyPlanToTemplate(plan({
        tue: { kind: 'items', items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }] },
        wed: { kind: 'rest' },
        thu: { kind: 'inherit' },
    }));

    expect(migrated.items).toEqual([
        expect.objectContaining({
            id: 'read',
            title: '阅读',
            repeatDays: ['mon', 'tue', 'fri', 'sat'],
            targetCount: 2,
            editMode: 'cycle',
        }),
        expect.objectContaining({
            id: 'pomo',
            repeatDays: ['thu'],
            type: 'pomodoroFocus',
        }),
    ]);
});
```

- [ ] **Step 2: Run domain tests and verify red**

Run: `cd app && npx vitest run src/domain/checkin.test.ts`

Expected: FAIL because `planTemplate`, `itemsForDate`, and `migrateWeeklyPlanToTemplate` do not exist yet.

- [ ] **Step 3: Implement domain model**

In `checkin.ts`, add `CheckinPlanItem`, `CheckinPlanTemplate`, `itemsForDate`, `isNoPlanDate`, and `migrateWeeklyPlanToTemplate`. Keep compatibility type aliases for old data only where normalizers need them.

Use `planTemplate` in `CheckinState`, replace `setWeeklyPlan` with `setPlanTemplate`, and update `dailySummary`, `weeklySummary`, `streakSummary`, and `applyPomodoroFocusCompletion` to use `itemsForDate`.

- [ ] **Step 4: Run domain tests and verify green**

Run: `cd app && npx vitest run src/domain/checkin.test.ts`

Expected: PASS.

### Task 2: Persistence, Preferences, Cloud, And Bridge

**Files:**
- Modify: `app/src/domain/checkinPersistence.ts`
- Modify: `app/src/domain/userPreferences.ts`
- Modify: `app/src/domain/cloudAccountData.ts`
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Test: `app/src/domain/checkinPersistence.test.ts`
- Test: `app/src/domain/userPreferencesPersistence.test.ts`
- Test: `app/src/domain/cloudAccountData.test.ts`
- Test: `app/src/domain/bridge/host.test.ts`

- [ ] **Step 1: Write failing persistence and bridge tests**

Update tests to expect `planTemplate` in snapshots and dispatch:

```ts
expect(buildUserPreferencesSnapshot(stores).checkin.planTemplate).toEqual(useCheckinStore.getState().planTemplate);
expect(buildSnapshot().checkin.planTemplate).toEqual(useCheckinStore.getState().planTemplate);
applyDispatch({ v: BRIDGE_VERSION, store: 'checkin', action: 'setPlanTemplate', args: [nextTemplate] });
expect(useCheckinStore.getState().planTemplate).toEqual(nextTemplate);
```

Add a legacy persistence test:

```ts
localStorage.setItem(STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    weeklyPlan: legacyWeeklyPlan,
    dailyRecords: {},
}));
const loaded = await loadPersistedCheckin();
expect(loaded?.planTemplate.schemaVersion).toBe(2);
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `cd app && npx vitest run src/domain/checkinPersistence.test.ts src/domain/userPreferencesPersistence.test.ts src/domain/cloudAccountData.test.ts src/domain/bridge/host.test.ts`

Expected: FAIL because the app still serializes `weeklyPlan`.

- [ ] **Step 3: Implement persistence and bridge update**

Normalize v2 `planTemplate`, accept legacy v1 `weeklyPlan`, and write v2 snapshots. Update bridge snapshot and dispatch types to use `setPlanTemplate`. Update clone helpers to clone templates and records.

- [ ] **Step 4: Run focused tests and verify green**

Run: `cd app && npx vitest run src/domain/checkinPersistence.test.ts src/domain/userPreferencesPersistence.test.ts src/domain/cloudAccountData.test.ts src/domain/bridge/host.test.ts`

Expected: PASS.

### Task 3: Editor And Today Panel UI

**Files:**
- Modify: `app/src/ui/CheckinPlanEditorPanel.tsx`
- Modify: `app/src/ui/CheckinPlanEditorPanel.css`
- Modify: `app/src/ui/TodayCheckinPanel.tsx`
- Modify: `app/src/ui/TodayCheckinPanel.css`
- Test: `app/src/ui/CheckinPlanEditorPanel.test.tsx`
- Test: `app/src/ui/TodayCheckinPanel.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Editor tests should cover repeat days and mode switching:

```tsx
it('edits repeat days in a draft and saves the template', () => {
    render(<CheckinPlanEditorPanel />);
    fireEvent.click(screen.getByRole('button', { name: '阅读 周二' }));
    fireEvent.click(screen.getByRole('button', { name: '保存计划' }));
    expect(useCheckinStore.getState().planTemplate.items.find((item) => item.id === 'read')?.repeatDays).toContain('tue');
});

it('edits count metadata without changing target count', () => {
    render(<CheckinPlanEditorPanel />);
    fireEvent.click(screen.getByRole('button', { name: '阅读 次数' }));
    fireEvent.change(screen.getByLabelText('阅读 输入值'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('阅读 循环次数'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '保存计划' }));
    expect(useCheckinStore.getState().planTemplate.items[0]).toMatchObject({
        targetCount: 2,
        countInputValue: 7,
        countLoopCount: 3,
    });
});
```

Today panel test should cover no-plan copy:

```tsx
it('renders no-plan state when no item repeats today', () => {
    useCheckinStore.setState({
        planTemplate: { schemaVersion: 2, carryToNextWeek: true, items: [] },
        dailyRecords: {},
        lastError: null,
    });
    render(<TodayCheckinPanel />);
    expect(screen.getByText('今日无计划')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests and verify red**

Run: `cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx src/ui/TodayCheckinPanel.test.tsx`

Expected: FAIL because the editor still renders day selector/rest/inherit UI and the today panel still uses rest semantics.

- [ ] **Step 3: Implement editor and today panel**

Rewrite the editor draft around `planTemplate.items`. Render the Pencil `s6g1w` structure: header, repeat content card, item rows, mode toggle, repeat weekday pills, count fields, add item, cancel, save. Update the today panel to call `itemsForDate` and render `今日无计划` when the effective list is empty.

- [ ] **Step 4: Run UI tests and verify green**

Run: `cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx src/ui/TodayCheckinPanel.test.tsx`

Expected: PASS.

### Task 4: Integration Verification And Cleanup

**Files:**
- Review all modified `app/src/domain/**`
- Review all modified `app/src/ui/**`

- [ ] **Step 1: Run check-in focused suite**

Run: `cd app && npx vitest run src/domain/checkin.test.ts src/domain/checkinPersistence.test.ts src/domain/userPreferencesPersistence.test.ts src/domain/cloudAccountData.test.ts src/domain/bridge/host.test.ts src/ui/CheckinPlanEditorPanel.test.tsx src/ui/TodayCheckinPanel.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run app build**

Run: `cd app && npm run build`

Expected: PASS with TypeScript and Vite build success.

- [ ] **Step 3: Run full app tests when focused suite and build pass**

Run: `cd app && npm test`

Expected: PASS.

- [ ] **Step 4: Review diff for unrelated changes**

Run: `git diff --stat` and `git diff -- app/src/domain app/src/ui docs/superpowers/plans docs/superpowers/specs`.

Expected: only check-in repeat plan implementation, tests, plan/spec docs, and no edits to `AUI/PUI.pen`.
