# Daily Check-in Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Pencil-designed daily check-in module as two independent Tauri windows with local persistence, Pomodoro completion linkage, and analysis-ready selectors.

**Architecture:** Add a focused `checkin` domain store owned by the main window. Mirror the store to `today-checkin` and `checkin-editor` windows through the existing bridge. Keep UI components pixel-aligned to Pencil nodes `KB3Vp` and `s6g1w`.

**Tech Stack:** React, TypeScript, Zustand, Vitest, Tauri 2, Rust window builders, native CSS.

---

## File Structure

- Create `app/src/domain/checkin.ts`: check-in types, main/mirror store factory, actions, selectors, Pomodoro idempotency.
- Create `app/src/domain/checkin.test.ts`: domain tests for inheritance, rest days, item increments, Pomodoro increments, summaries, and week rollover.
- Create `app/src/domain/checkinPersistence.ts`: local persistence read/write helpers using Tauri storage-safe browser APIs.
- Create `app/src/domain/checkinPersistence.test.ts`: persistence tests with malformed snapshots and valid snapshots.
- Create `app/src/domain/checkinWindow.ts`: today/editor window open/show/hide controller and size constants.
- Modify `app/src/domain/bridge/protocol.ts`: include check-in snapshot and dispatch actions.
- Modify `app/src/domain/bridge/host.ts`: clone check-in state, apply check-in dispatch, subscribe to check-in changes.
- Modify `app/src/domain/bridge/client.ts`: apply check-in snapshots to mirror stores.
- Modify `app/src/App.tsx`: hydrate check-in persistence, mount check-in controller, process Pomodoro end events.
- Modify `app/src/main.tsx`: route `?window=today-checkin` and `?window=checkin-editor`.
- Create `app/src/TodayCheckinApp.tsx`: mirror client root for the compact window.
- Create `app/src/CheckinEditorApp.tsx`: mirror client root for the editor window.
- Create `app/src/ui/TodayCheckinPanel.tsx`: compact panel mapped to Pencil `KB3Vp`.
- Create `app/src/ui/TodayCheckinPanel.css`: panel styles, states, and scale-safe dimensions.
- Create `app/src/ui/TodayCheckinPanel.test.tsx`: incomplete, complete, rest, increment, edit-open tests.
- Create `app/src/ui/CheckinPlanEditorPanel.tsx`: editor mapped to Pencil `s6g1w`.
- Create `app/src/ui/CheckinPlanEditorPanel.css`: editor styles, clamped scroll, rest-state variant.
- Create `app/src/ui/CheckinPlanEditorPanel.test.tsx`: draft editing, save, cancel, rest toggle tests.
- Modify `app/src-tauri/src/lib.rs`: add hidden/lazy `today-checkin` and `checkin-editor` windows plus commands.
- Modify `app/src-tauri/capabilities/default.json`: allow both new window labels.
- Create `app/src/checkinWindowConfig.test.ts`: static tests for capabilities, Rust builders, and main-window non-regression.

## Task 1: Check-in Domain Model and Selectors

**Files:**
- Create: `app/src/domain/checkin.ts`
- Create: `app/src/domain/checkin.test.ts`

- [ ] **Step 1: Write failing tests for effective plans, rest days, and summaries**

Add this test file:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createCheckinStore,
    defaultWeeklyPlan,
    effectiveItemsForDate,
    dailySummary,
    weeklySummary,
    type WeeklyCheckinPlan,
} from './checkin';

const weekStartDate = '2026-05-18';

function plan(overrides: Partial<WeeklyCheckinPlan['days']>): WeeklyCheckinPlan {
    return {
        weekStartDate,
        carryToNextWeek: true,
        days: {
            mon: { kind: 'items', items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }] },
            tue: { kind: 'inherit' },
            wed: { kind: 'rest' },
            thu: { kind: 'items', items: [{ id: 'pomo', title: '专注番茄', type: 'pomodoroFocus', targetCount: 3 }] },
            fri: { kind: 'inherit' },
            sat: { kind: 'inherit' },
            sun: { kind: 'rest' },
            ...overrides,
        },
    };
}

describe('checkin domain', () => {
    beforeEach(() => {
        vi.setSystemTime(new Date('2026-05-19T10:00:00+08:00'));
    });

    it('resolves inherit days from the previous ordinary day without copying records', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({ weeklyPlan: plan({}) });

        expect(effectiveItemsForDate(store.getState(), '2026-05-19')).toEqual([
            { id: 'read', title: '阅读', type: 'manual', targetCount: 2 },
        ]);

        store.getState().incrementItem('2026-05-19', 'read');

        expect(store.getState().dailyRecords['2026-05-19'].countsByItemId.read).toBe(1);
        expect(store.getState().dailyRecords['2026-05-18']).toBeUndefined();
    });

    it('excludes rest days from summaries', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({ weeklyPlan: plan({}) });

        expect(dailySummary(store.getState(), '2026-05-20')).toMatchObject({
            date: '2026-05-20',
            isRestDay: true,
            totalTarget: 0,
            completedCount: 0,
            completionRate: 1,
        });

        const summary = weeklySummary(store.getState(), weekStartDate);
        expect(summary.restDays).toEqual(['2026-05-20', '2026-05-24']);
        expect(summary.totalTarget).toBe(10);
    });

    it('increments every pomodoroFocus item once per Pomodoro end event id', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({
            weeklyPlan: plan({
                tue: {
                    kind: 'items',
                    items: [
                        { id: 'p1', title: '早间番茄', type: 'pomodoroFocus', targetCount: 1 },
                        { id: 'p2', title: '晚间番茄', type: 'pomodoroFocus', targetCount: 1 },
                        { id: 'm1', title: '喝水', type: 'manual', targetCount: 1 },
                    ],
                },
            }),
        });

        store.getState().applyPomodoroFocusCompletion('2026-05-19', 42);
        store.getState().applyPomodoroFocusCompletion('2026-05-19', 42);

        expect(store.getState().dailyRecords['2026-05-19'].countsByItemId).toEqual({
            p1: 1,
            p2: 1,
        });
        expect(store.getState().dailyRecords['2026-05-19'].processedPomodoroEndEventIds).toEqual([42]);
    });

    it('creates a default current-week plan', () => {
        expect(defaultWeeklyPlan('2026-05-18')).toMatchObject({
            weekStartDate: '2026-05-18',
            carryToNextWeek: true,
        });
    });

    it('rolls the current plan forward when carryToNextWeek is enabled', () => {
        const store = createCheckinStore({ isMirrorWindow: false });
        store.setState({ weeklyPlan: plan({}) });

        store.getState().rollForwardToDate('2026-05-25');

        expect(store.getState().weeklyPlan.weekStartDate).toBe('2026-05-25');
        expect(store.getState().weeklyPlan.days.mon).toEqual({
            kind: 'items',
            items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }],
        });
    });
});
```

- [ ] **Step 2: Run the domain tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/domain/checkin.test.ts
```

Expected: FAIL because `src/domain/checkin.ts` does not exist.

- [ ] **Step 3: Implement types, store, selectors, and actions**

Create `app/src/domain/checkin.ts` with these exported shapes and behavior:

```ts
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

export type CheckinItemType = 'manual' | 'pomodoroFocus';
export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface CheckinItem {
    id: string;
    title: string;
    type: CheckinItemType;
    targetCount: number;
}

export type CheckinDayPlan =
    | { kind: 'inherit' }
    | { kind: 'rest' }
    | { kind: 'items'; items: CheckinItem[] };

export interface WeeklyCheckinPlan {
    weekStartDate: string;
    days: Record<WeekdayKey, CheckinDayPlan>;
    carryToNextWeek: boolean;
}

export interface DailyCheckinRecord {
    date: string;
    countsByItemId: Record<string, number>;
    processedPomodoroEndEventIds: number[];
}

export interface CheckinSummary {
    date: string;
    isRestDay: boolean;
    completedCount: number;
    totalTarget: number;
    completionRate: number;
}

export interface WeeklyCheckinSummary {
    weekStartDate: string;
    restDays: string[];
    completedCount: number;
    totalTarget: number;
    completionRate: number;
}

export interface CheckinState {
    weeklyPlan: WeeklyCheckinPlan;
    dailyRecords: Record<string, DailyCheckinRecord>;
    lastError: string | null;
}

export interface CheckinActions {
    setWeeklyPlan: (plan: WeeklyCheckinPlan) => void;
    incrementItem: (date: string, itemId: string) => void;
    applyPomodoroFocusCompletion: (date: string, endEventId: number) => void;
    rollForwardToDate: (date: string) => void;
    hydrateCheckin: (snapshot: Pick<CheckinState, 'weeklyPlan' | 'dailyRecords'>) => void;
    setLastError: (message: string | null) => void;
}

export type CheckinStore = UseBoundStore<StoreApi<CheckinState & CheckinActions>>;

const WEEKDAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function weekdayForDate(date: string): WeekdayKey {
    const day = new Date(`${date}T12:00:00`).getDay();
    return WEEKDAYS[(day + 6) % 7];
}

export function addDays(date: string, offset: number): string {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
}

export function defaultWeeklyPlan(weekStartDate: string): WeeklyCheckinPlan {
    return {
        weekStartDate,
        carryToNextWeek: true,
        days: {
            mon: { kind: 'items', items: [{ id: 'pomodoro-focus', title: '专注番茄', type: 'pomodoroFocus', targetCount: 4 }] },
            tue: { kind: 'inherit' },
            wed: { kind: 'inherit' },
            thu: { kind: 'inherit' },
            fri: { kind: 'inherit' },
            sat: { kind: 'inherit' },
            sun: { kind: 'rest' },
        },
    };
}

function currentWeekStart(date = new Date()): string {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    const diff = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diff);
    return d.toISOString().slice(0, 10);
}

function weekStartForDate(date: string): string {
    return currentWeekStart(new Date(`${date}T12:00:00`));
}

function emptyRecord(date: string): DailyCheckinRecord {
    return { date, countsByItemId: {}, processedPomodoroEndEventIds: [] };
}

function effectivePlanForDate(state: CheckinState, date: string): CheckinDayPlan {
    let cursor = date;
    for (let i = 0; i < 7; i += 1) {
        const plan = state.weeklyPlan.days[weekdayForDate(cursor)];
        if (plan.kind !== 'inherit') return plan;
        cursor = addDays(cursor, -1);
    }
    return { kind: 'items', items: [] };
}

export function effectiveItemsForDate(state: CheckinState, date: string): CheckinItem[] {
    const plan = effectivePlanForDate(state, date);
    return plan.kind === 'items' ? plan.items : [];
}

export function isRestDate(state: CheckinState, date: string): boolean {
    return effectivePlanForDate(state, date).kind === 'rest';
}

export function recordForDate(state: CheckinState, date: string): DailyCheckinRecord {
    return state.dailyRecords[date] ?? emptyRecord(date);
}

export function dailySummary(state: CheckinState, date: string): CheckinSummary {
    if (isRestDate(state, date)) {
        return { date, isRestDay: true, completedCount: 0, totalTarget: 0, completionRate: 1 };
    }
    const record = recordForDate(state, date);
    const items = effectiveItemsForDate(state, date);
    const totalTarget = items.reduce((sum, item) => sum + item.targetCount, 0);
    const completedCount = items.reduce(
        (sum, item) => sum + Math.min(record.countsByItemId[item.id] ?? 0, item.targetCount),
        0,
    );
    return {
        date,
        isRestDay: false,
        completedCount,
        totalTarget,
        completionRate: totalTarget === 0 ? 1 : completedCount / totalTarget,
    };
}

export function weeklySummary(state: CheckinState, weekStartDate: string): WeeklyCheckinSummary {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i));
    const summaries = days.map((date) => dailySummary(state, date));
    const active = summaries.filter((summary) => !summary.isRestDay);
    const totalTarget = active.reduce((sum, summary) => sum + summary.totalTarget, 0);
    const completedCount = active.reduce((sum, summary) => sum + summary.completedCount, 0);
    return {
        weekStartDate,
        restDays: summaries.filter((summary) => summary.isRestDay).map((summary) => summary.date),
        completedCount,
        totalTarget,
        completionRate: totalTarget === 0 ? 1 : completedCount / totalTarget,
    };
}

export function createCheckinStore(opts: { isMirrorWindow: boolean }): CheckinStore {
    if (opts.isMirrorWindow) {
        return create<CheckinState & CheckinActions>((set) => ({
            weeklyPlan: defaultWeeklyPlan(currentWeekStart()),
            dailyRecords: {},
            lastError: null,
            setWeeklyPlan: (plan) => void dispatch({ v: BRIDGE_VERSION, store: 'checkin', action: 'setWeeklyPlan', args: [plan] }),
            incrementItem: (date, itemId) => void dispatch({ v: BRIDGE_VERSION, store: 'checkin', action: 'incrementItem', args: [date, itemId] }),
            applyPomodoroFocusCompletion: () => {},
            rollForwardToDate: () => {},
            hydrateCheckin: (snapshot) => set(snapshot),
            setLastError: (message) => set({ lastError: message }),
        }));
    }
    return create<CheckinState & CheckinActions>((set, get) => ({
        weeklyPlan: defaultWeeklyPlan(currentWeekStart()),
        dailyRecords: {},
        lastError: null,
        setWeeklyPlan: (weeklyPlan) => set({ weeklyPlan }),
        incrementItem: (date, itemId) => set((state) => {
            const record = recordForDate(state, date);
            return {
                dailyRecords: {
                    ...state.dailyRecords,
                    [date]: {
                        ...record,
                        countsByItemId: {
                            ...record.countsByItemId,
                            [itemId]: (record.countsByItemId[itemId] ?? 0) + 1,
                        },
                    },
                },
            };
        }),
        applyPomodoroFocusCompletion: (date, endEventId) => set((state) => {
            const record = recordForDate(state, date);
            if (record.processedPomodoroEndEventIds.includes(endEventId)) return state;
            const items = effectiveItemsForDate(state, date).filter((item) => item.type === 'pomodoroFocus');
            if (items.length === 0) {
                return {
                    dailyRecords: {
                        ...state.dailyRecords,
                        [date]: {
                            ...record,
                            processedPomodoroEndEventIds: [...record.processedPomodoroEndEventIds, endEventId],
                        },
                    },
                };
            }
            const countsByItemId = { ...record.countsByItemId };
            for (const item of items) countsByItemId[item.id] = (countsByItemId[item.id] ?? 0) + 1;
            return {
                dailyRecords: {
                    ...state.dailyRecords,
                    [date]: {
                        ...record,
                        countsByItemId,
                        processedPomodoroEndEventIds: [...record.processedPomodoroEndEventIds, endEventId],
                    },
                },
            };
        }),
        rollForwardToDate: (date) => {
            const nextWeekStart = weekStartForDate(date);
            const current = get().weeklyPlan;
            if (nextWeekStart <= current.weekStartDate) return;
            set({
                weeklyPlan: current.carryToNextWeek
                    ? { ...current, weekStartDate: nextWeekStart }
                    : defaultWeeklyPlan(nextWeekStart),
            });
        },
        hydrateCheckin: (snapshot) => set(snapshot),
        setLastError: (message) => set({ lastError: message }),
    }));
}

function detectMirrorWindow(): boolean {
    if (typeof window === 'undefined') return false;
    const which = new URLSearchParams(window.location.search).get('window');
    return which === 'today-checkin' || which === 'checkin-editor';
}

export const useCheckinStore = createCheckinStore({ isMirrorWindow: detectMirrorWindow() });
```

- [ ] **Step 4: Run tests and verify Task 1 passes**

Run:

```bash
cd app && npx vitest run src/domain/checkin.test.ts
```

Expected: PASS for all tests in `checkin.test.ts`.

- [ ] **Step 5: Commit Task 1**

```bash
git add app/src/domain/checkin.ts app/src/domain/checkin.test.ts
git commit -m "feat: add checkin domain model"
```

## Task 2: Persistence and Startup Hydration

**Files:**
- Create: `app/src/domain/checkinPersistence.ts`
- Create: `app/src/domain/checkinPersistence.test.ts`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Write failing persistence tests**

Create `app/src/domain/checkinPersistence.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultWeeklyPlan } from './checkin';
import { loadPersistedCheckin, savePersistedCheckin, STORAGE_KEY } from './checkinPersistence';

describe('checkin persistence', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('round-trips schemaVersion 1 snapshots', async () => {
        const snapshot = {
            schemaVersion: 1 as const,
            weeklyPlan: defaultWeeklyPlan('2026-05-18'),
            dailyRecords: {
                '2026-05-19': {
                    date: '2026-05-19',
                    countsByItemId: { read: 2 },
                    processedPomodoroEndEventIds: [7],
                },
            },
        };

        await savePersistedCheckin(snapshot);

        expect(await loadPersistedCheckin()).toEqual(snapshot);
    });

    it('returns null for malformed persisted data', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 99 }));

        expect(await loadPersistedCheckin()).toBeNull();
    });
});
```

- [ ] **Step 2: Run persistence tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/domain/checkinPersistence.test.ts
```

Expected: FAIL because `checkinPersistence.ts` does not exist.

- [ ] **Step 3: Implement persistence helpers**

Create `app/src/domain/checkinPersistence.ts`:

```ts
import type { DailyCheckinRecord, WeeklyCheckinPlan } from './checkin';

export const STORAGE_KEY = 'cpa-v2-checkin-v1';

export interface PersistedCheckinSnapshot {
    schemaVersion: 1;
    weeklyPlan: WeeklyCheckinPlan;
    dailyRecords: Record<string, DailyCheckinRecord>;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSnapshot(value: unknown): value is PersistedCheckinSnapshot {
    if (!isObject(value)) return false;
    return value.schemaVersion === 1 && isObject(value.weeklyPlan) && isObject(value.dailyRecords);
}

export async function loadPersistedCheckin(): Promise<PersistedCheckinSnapshot | null> {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return isSnapshot(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export async function savePersistedCheckin(snapshot: PersistedCheckinSnapshot): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}
```

- [ ] **Step 4: Add App hydration and persistence subscription**

Modify `app/src/App.tsx` imports:

```ts
import { useCheckinStore } from './domain/checkin';
import { loadPersistedCheckin, savePersistedCheckin } from './domain/checkinPersistence';
```

Add this effect inside `App`:

```tsx
function todayLocalDate(): string {
    return new Date().toISOString().slice(0, 10);
}

useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    loadPersistedCheckin()
        .then((snapshot) => {
            if (cancelled) return;
            if (snapshot) {
                useCheckinStore.getState().hydrateCheckin({
                    weeklyPlan: snapshot.weeklyPlan,
                    dailyRecords: snapshot.dailyRecords,
                });
            }
            useCheckinStore.getState().rollForwardToDate(todayLocalDate());
            unsubscribe = useCheckinStore.subscribe((state) => {
                void savePersistedCheckin({
                    schemaVersion: 1,
                    weeklyPlan: state.weeklyPlan,
                    dailyRecords: state.dailyRecords,
                }).catch((error) => {
                    useCheckinStore.getState().setLastError(String(error));
                });
            });
        })
        .catch((error) => {
            useCheckinStore.getState().setLastError(String(error));
        });

    return () => {
        cancelled = true;
        unsubscribe();
    };
}, []);
```

- [ ] **Step 5: Run persistence and app tests**

Run:

```bash
cd app && npx vitest run src/domain/checkinPersistence.test.ts src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add app/src/domain/checkinPersistence.ts app/src/domain/checkinPersistence.test.ts app/src/App.tsx
git commit -m "feat: persist checkin state"
```

## Task 3: Bridge Snapshot and Dispatch

**Files:**
- Modify: `app/src/domain/bridge/protocol.ts`
- Modify: `app/src/domain/bridge/host.ts`
- Modify: `app/src/domain/bridge/client.ts`
- Modify: `app/src/domain/bridge/protocol.test.ts`
- Modify: `app/src/domain/bridge/host.test.ts`
- Modify: `app/src/domain/bridge/client.test.ts`

- [ ] **Step 1: Add failing bridge tests**

Add assertions to bridge tests:

```ts
import { useCheckinStore } from '../checkin';

it('builds snapshots with checkin state', () => {
    useCheckinStore.setState({
        weeklyPlan: defaultWeeklyPlan('2026-05-18'),
        dailyRecords: {},
        lastError: null,
    });

    const snapshot = buildSnapshot();

    expect(snapshot.checkin.weeklyPlan.weekStartDate).toBe('2026-05-18');
    expect(snapshot.checkin.dailyRecords).toEqual({});
});

it('applies checkin snapshots to mirror stores', () => {
    applySnapshotToMirrors({
        ...buildSnapshot(),
        checkin: {
            weeklyPlan: defaultWeeklyPlan('2026-05-18'),
            dailyRecords: {
                '2026-05-19': { date: '2026-05-19', countsByItemId: { read: 1 }, processedPomodoroEndEventIds: [] },
            },
            lastError: null,
        },
    });

    expect(useCheckinStore.getState().dailyRecords['2026-05-19'].countsByItemId.read).toBe(1);
});

it('dispatches checkin incrementItem to the main store', () => {
    applyDispatch({
        v: BRIDGE_VERSION,
        store: 'checkin',
        action: 'incrementItem',
        args: ['2026-05-19', 'read'],
    });

    expect(useCheckinStore.getState().dailyRecords['2026-05-19'].countsByItemId.read).toBe(1);
});
```

- [ ] **Step 2: Run bridge tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts
```

Expected: FAIL with missing `checkin` fields or unsupported dispatch action.

- [ ] **Step 3: Extend bridge protocol types**

In `app/src/domain/bridge/protocol.ts`, import check-in types and add:

```ts
import type { DailyCheckinRecord, WeeklyCheckinPlan } from '../checkin';

export interface BridgeSnapshot {
    // existing fields stay in place
    checkin: {
        weeklyPlan: WeeklyCheckinPlan;
        dailyRecords: Record<string, DailyCheckinRecord>;
        lastError: string | null;
    };
}

export type DispatchPayload =
    // existing union members stay in place
    | { v: typeof BRIDGE_VERSION; store: 'checkin'; action: 'setWeeklyPlan'; args: [WeeklyCheckinPlan] }
    | { v: typeof BRIDGE_VERSION; store: 'checkin'; action: 'incrementItem'; args: [string, string] };
```

- [ ] **Step 4: Extend host snapshot, signature, and dispatch**

In `app/src/domain/bridge/host.ts`, import:

```ts
import { useCheckinStore, type DailyCheckinRecord } from '../checkin';
```

Add helpers:

```ts
function cloneDailyRecords(records: Record<string, DailyCheckinRecord>): Record<string, DailyCheckinRecord> {
    return Object.fromEntries(
        Object.entries(records).map(([date, record]) => [
            date,
            {
                date: record.date,
                countsByItemId: { ...record.countsByItemId },
                processedPomodoroEndEventIds: [...record.processedPomodoroEndEventIds],
            },
        ]),
    );
}

export function checkinSig(s: ReturnType<typeof useCheckinStore.getState>): string {
    return JSON.stringify([s.weeklyPlan, s.dailyRecords, s.lastError]);
}
```

Add `checkin` inside `buildSnapshot()`:

```ts
const c = useCheckinStore.getState();

checkin: {
    weeklyPlan: {
        ...c.weeklyPlan,
        days: { ...c.weeklyPlan.days },
    },
    dailyRecords: cloneDailyRecords(c.dailyRecords),
    lastError: c.lastError,
},
```

Add dispatch handling:

```ts
case 'checkin': {
    const c = useCheckinStore.getState();
    switch (payload.action) {
        case 'setWeeklyPlan': c.setWeeklyPlan(...payload.args); return;
        case 'incrementItem': c.incrementItem(...payload.args); return;
    }
    return;
}
```

Subscribe in `useBridgeHost()`:

```ts
let prevCheckin = checkinSig(useCheckinStore.getState());

useCheckinStore.subscribe((s) => {
    const sig = checkinSig(s);
    if (sig === prevCheckin) return;
    prevCheckin = sig;
    void sendSnapshot();
});
```

- [ ] **Step 5: Extend client snapshot application**

In `app/src/domain/bridge/client.ts`, import `useCheckinStore` and add to `applySnapshotToMirrors()`:

```ts
useCheckinStore.setState({
    weeklyPlan: {
        ...snap.checkin.weeklyPlan,
        days: { ...snap.checkin.weeklyPlan.days },
    },
    dailyRecords: cloneDailyRecords(snap.checkin.dailyRecords),
    lastError: snap.checkin.lastError,
});
```

Copy the same `cloneDailyRecords` helper into client or export it from a shared check-in helper if tests require it.

- [ ] **Step 6: Run bridge tests**

Run:

```bash
cd app && npx vitest run src/domain/bridge/protocol.test.ts src/domain/bridge/host.test.ts src/domain/bridge/client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add app/src/domain/bridge app/src/domain/checkin.ts
git commit -m "feat: mirror checkin state across windows"
```

## Task 4: Tauri Window Plumbing and React Roots

**Files:**
- Create: `app/src/domain/checkinWindow.ts`
- Create: `app/src/TodayCheckinApp.tsx`
- Create: `app/src/CheckinEditorApp.tsx`
- Modify: `app/src/main.tsx`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/capabilities/default.json`
- Create: `app/src/checkinWindowConfig.test.ts`

- [ ] **Step 1: Write failing static window config tests**

Create `app/src/checkinWindowConfig.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const capabilitiesPath = path.join(here, '../src-tauri/capabilities/default.json');
const libRsPath = path.join(here, '../src-tauri/src/lib.rs');
const mainPath = path.join(here, 'main.tsx');

describe('checkin independent windows', () => {
    it('allows checkin window labels in capabilities', () => {
        const capabilities = JSON.parse(readFileSync(capabilitiesPath, 'utf8'));
        expect(capabilities.windows).toContain('today-checkin');
        expect(capabilities.windows).toContain('checkin-editor');
    });

    it('routes checkin webview roots', () => {
        const source = readFileSync(mainPath, 'utf8');
        expect(source).toMatch(/today-checkin/);
        expect(source).toMatch(/checkin-editor/);
        expect(source).toMatch(/TodayCheckinApp/);
        expect(source).toMatch(/CheckinEditorApp/);
    });

    it('builds transparent decorationless checkin windows', () => {
        const source = readFileSync(libRsPath, 'utf8');
        expect(source).toMatch(/build_today_checkin_window_hidden/);
        expect(source).toMatch(/build_checkin_editor_window_hidden/);
        expect(source).toMatch(/WebviewWindowBuilder::new\(app,\s*"today-checkin"/);
        expect(source).toMatch(/WebviewWindowBuilder::new\(app,\s*"checkin-editor"/);
        expect(source).toMatch(/index\.html\?window=today-checkin/);
        expect(source).toMatch(/index\.html\?window=checkin-editor/);
        expect(source).toMatch(/const TODAY_CHECKIN_W:\s*f64\s*=\s*278\.0/);
        expect(source).toMatch(/const CHECKIN_EDITOR_W:\s*f64\s*=\s*460\.0/);
        expect(source).toMatch(/open_today_checkin_window/);
        expect(source).toMatch(/open_checkin_editor_window/);
    });
});
```

- [ ] **Step 2: Run window config tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/checkinWindowConfig.test.ts
```

Expected: FAIL because roots, capabilities, and Rust commands do not exist.

- [ ] **Step 3: Add React roots**

Create `app/src/TodayCheckinApp.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { useBridgeClient } from './domain/bridge/client';
import { useSettingsStore } from './domain/settings';
import { TodayCheckinPanel } from './ui/TodayCheckinPanel';

export default function TodayCheckinApp() {
    useBridgeClient();
    const uiScale = useSettingsStore((s) => s.uiScale);
    return (
        <div className="today-checkin-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <TodayCheckinPanel />
        </div>
    );
}
```

Create `app/src/CheckinEditorApp.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { useBridgeClient } from './domain/bridge/client';
import { useSettingsStore } from './domain/settings';
import { CheckinPlanEditorPanel } from './ui/CheckinPlanEditorPanel';

export default function CheckinEditorApp() {
    useBridgeClient();
    const uiScale = useSettingsStore((s) => s.uiScale);
    return (
        <div className="checkin-editor-window-root" style={{ '--app-ui-scale': String(uiScale) } as CSSProperties}>
            <CheckinPlanEditorPanel />
        </div>
    );
}
```

Modify `app/src/main.tsx`:

```tsx
import TodayCheckinApp from "./TodayCheckinApp";
import CheckinEditorApp from "./CheckinEditorApp";

const Root = which === "settings"
    ? SettingsApp
    : which === "devalign"
        ? DevAlignApp
        : which === "video-player"
            ? VideoPlayerApp
            : which === "input-counter"
                ? InputCounterApp
                : which === "remote-player"
                    ? RemotePlayerCardApp
                    : which === "today-checkin"
                        ? TodayCheckinApp
                        : which === "checkin-editor"
                            ? CheckinEditorApp
                            : App;
```

- [ ] **Step 4: Add JS window controller**

Create `app/src/domain/checkinWindow.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { isRestDate, useCheckinStore } from './checkin';
import { useScaledWindowSize } from './scaledWindow';

export const TODAY_CHECKIN_BASE_WIDTH = 278;
export const TODAY_CHECKIN_BASE_HEIGHT = 289;
export const CHECKIN_EDITOR_BASE_WIDTH = 460;
export const CHECKIN_EDITOR_BASE_HEIGHT = 898;

function todayLocalDate(): string {
    return new Date().toISOString().slice(0, 10);
}

export function useCheckinWindowController(): void {
    const weeklyPlan = useCheckinStore((s) => s.weeklyPlan);
    const dailyRecords = useCheckinStore((s) => s.dailyRecords);

    useEffect(() => {
        void invoke('open_today_checkin_window').catch((error) => {
            useCheckinStore.getState().setLastError(String(error));
        });
    }, [weeklyPlan, dailyRecords]);

    useScaledWindowSize({
        label: 'today-checkin',
        baseWidth: TODAY_CHECKIN_BASE_WIDTH,
        baseHeight: TODAY_CHECKIN_BASE_HEIGHT,
        minWidth: TODAY_CHECKIN_BASE_WIDTH,
        minHeight: isRestDate(useCheckinStore.getState(), todayLocalDate()) ? 160 : TODAY_CHECKIN_BASE_HEIGHT,
        enabled: true,
    });
}

export function openCheckinEditorWindow(): Promise<void> {
    return invoke('open_checkin_editor_window');
}
```

`useScaledWindowSize` reads `uiScale` internally, so the controller does not need a separate scale parameter.

- [ ] **Step 5: Add Rust window builders and commands**

In `app/src-tauri/src/lib.rs`, add constants near existing window constants:

```rust
const TODAY_CHECKIN_W: f64 = 278.0;
const TODAY_CHECKIN_H: f64 = 289.0;
const CHECKIN_EDITOR_W: f64 = 460.0;
const CHECKIN_EDITOR_H: f64 = 898.0;
```

Add builders:

```rust
fn build_today_checkin_window_hidden(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    let url = WebviewUrl::App("index.html?window=today-checkin".into());
    let w = WebviewWindowBuilder::new(app, "today-checkin", url)
        .title("今日打卡")
        .inner_size(TODAY_CHECKIN_W, TODAY_CHECKIN_H)
        .resizable(false)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .build()?;
    window_helpers::install_first_mouse_only(&w);
    Ok(w)
}

fn build_checkin_editor_window_hidden(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, tauri::Error> {
    let url = WebviewUrl::App("index.html?window=checkin-editor".into());
    let w = WebviewWindowBuilder::new(app, "checkin-editor", url)
        .title("打卡计划")
        .inner_size(CHECKIN_EDITOR_W, CHECKIN_EDITOR_H)
        .min_inner_size(360.0, 420.0)
        .resizable(true)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .build()?;
    window_helpers::install_first_mouse_only(&w);
    Ok(w)
}
```

Add commands:

```rust
#[tauri::command]
fn open_today_checkin_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("today-checkin")
        .ok_or_else(|| "today-checkin window not found".to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window_helpers::set_always_on_top_native(&window, true)?;
    Ok(())
}

#[tauri::command]
fn open_checkin_editor_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("checkin-editor")
        .ok_or_else(|| "checkin-editor window not found".to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window_helpers::set_always_on_top_native(&window, true)?;
    Ok(())
}

#[tauri::command]
fn close_checkin_editor_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("checkin-editor") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Register the commands in `invoke_handler!` and call both builders in `setup`, next to existing hidden-window builders.

- [ ] **Step 6: Update capabilities**

In `app/src-tauri/capabilities/default.json`, add the window labels:

```json
"windows": [
  "main",
  "settings",
  "pomodoro-video-player",
  "input-counter",
  "remote-player-0",
  "remote-player-1",
  "remote-player-2",
  "remote-player-3",
  "remote-player-4",
  "remote-player-5",
  "remote-player-6",
  "today-checkin",
  "checkin-editor"
]
```

- [ ] **Step 7: Run focused tests and Rust check**

Run:

```bash
cd app && npx vitest run src/checkinWindowConfig.test.ts
cd app/src-tauri && cargo check
```

Expected: both commands pass.

- [ ] **Step 8: Commit Task 4**

```bash
git add app/src/domain/checkinWindow.ts app/src/TodayCheckinApp.tsx app/src/CheckinEditorApp.tsx app/src/main.tsx app/src-tauri/src/lib.rs app/src-tauri/capabilities/default.json app/src/checkinWindowConfig.test.ts
git commit -m "feat: add checkin windows"
```

## Task 5: Today Check-in Panel UI

**Files:**
- Create: `app/src/ui/TodayCheckinPanel.tsx`
- Create: `app/src/ui/TodayCheckinPanel.css`
- Create: `app/src/ui/TodayCheckinPanel.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Create `app/src/ui/TodayCheckinPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckinStore } from '../domain/checkin';
import { TodayCheckinPanel } from './TodayCheckinPanel';

vi.mock('../domain/checkinWindow', () => ({
    openCheckinEditorWindow: vi.fn(() => Promise.resolve()),
}));

describe('TodayCheckinPanel', () => {
    beforeEach(() => {
        useCheckinStore.setState({
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: { kind: 'items', items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }] },
                    tue: { kind: 'inherit' },
                    wed: { kind: 'rest' },
                    thu: { kind: 'inherit' },
                    fri: { kind: 'inherit' },
                    sat: { kind: 'inherit' },
                    sun: { kind: 'rest' },
                },
            },
            dailyRecords: {},
            lastError: null,
        });
        vi.setSystemTime(new Date('2026-05-19T10:00:00+08:00'));
    });

    it('renders incomplete progress and increments manual items', () => {
        render(<TodayCheckinPanel />);

        expect(screen.getByText('今日打卡')).toBeInTheDocument();
        expect(screen.getByText('0/1 项已完成')).toBeInTheDocument();
        expect(screen.getByText('阅读')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '阅读 +1' }));

        expect(useCheckinStore.getState().dailyRecords['2026-05-19'].countsByItemId.read).toBe(1);
    });

    it('renders complete state when every item reaches target', () => {
        useCheckinStore.setState({
            dailyRecords: {
                '2026-05-19': { date: '2026-05-19', countsByItemId: { read: 2 }, processedPomodoroEndEventIds: [] },
            },
        });

        render(<TodayCheckinPanel />);

        expect(screen.getByText('全部完成')).toBeInTheDocument();
        expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('renders a compact rest state while keeping the editor available', () => {
        vi.setSystemTime(new Date('2026-05-20T10:00:00+08:00'));

        render(<TodayCheckinPanel />);

        expect(screen.getByText('当天休息')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '编辑打卡计划' })).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run UI tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/ui/TodayCheckinPanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement TodayCheckinPanel**

Create `app/src/ui/TodayCheckinPanel.tsx`:

```tsx
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
    dailySummary,
    effectiveItemsForDate,
    isRestDate,
    recordForDate,
    useCheckinStore,
} from '../domain/checkin';
import { openCheckinEditorWindow } from '../domain/checkinWindow';
import { shouldStartWindowDrag } from './windowDrag';
import './TodayCheckinPanel.css';

function todayLocalDate(): string {
    return new Date().toISOString().slice(0, 10);
}

export function TodayCheckinPanel() {
    const state = useCheckinStore();
    const date = todayLocalDate();
    const rest = isRestDate(state, date);
    const summary = dailySummary(state, date);
    const items = effectiveItemsForDate(state, date);
    const record = recordForDate(state, date);
    const completedItems = items.filter((item) => (record.countsByItemId[item.id] ?? 0) >= item.targetCount).length;
    const pct = Math.round(summary.completionRate * 100);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!shouldStartWindowDrag(e.button, e.target)) return;
        void getCurrentWindow().startDragging().catch(() => {});
    };

    return (
        <div className={`today-checkin-panel ${pct >= 100 ? 'is-complete' : ''} ${rest ? 'is-rest' : ''}`} onPointerDown={onPointerDown}>
            <div className="today-checkin-head">
                <div className="today-checkin-title-wrap">
                    <h2>今日打卡</h2>
                    <p>{rest ? '今天不计入本周目标' : `${completedItems}/${items.length} 项已完成`}</p>
                </div>
                <span className="today-checkin-status">{rest ? '休息' : pct >= 100 ? '全部完成' : '未完成'}</span>
            </div>

            {rest ? (
                <div className="today-checkin-rest">
                    <span>当天休息</span>
                    <p>今天不生成打卡项目，明天继续。</p>
                </div>
            ) : (
                <>
                    <div className="today-checkin-progress">
                        <div className="today-checkin-progress-meta">
                            <span>今日进度</span>
                            <strong>{pct}%</strong>
                        </div>
                        <div className="today-checkin-track"><div style={{ width: `${pct}%` }} /></div>
                    </div>
                    <div className="today-checkin-list">
                        {items.map((item) => {
                            const count = record.countsByItemId[item.id] ?? 0;
                            const done = count >= item.targetCount;
                            return (
                                <div key={item.id} className={`today-checkin-item ${done ? 'done' : ''}`}>
                                    <div className="today-checkin-item-copy">
                                        <strong>{item.title}</strong>
                                        <span>{count}/{item.targetCount} 次</span>
                                    </div>
                                    <div className="today-checkin-item-actions">
                                        <span>{done ? '完成' : '进行中'}</span>
                                        <button aria-label={`${item.title} +1`} onClick={() => state.incrementItem(date, item.id)}>+1</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            <div className="today-checkin-footer">
                <span>{rest ? '休息日不影响连续完成' : '点击 +1 记录一次完成'}</span>
                <button aria-label="编辑打卡计划" onClick={() => void openCheckinEditorWindow()}>编辑</button>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Implement CSS mapped to Pencil**

Create `app/src/ui/TodayCheckinPanel.css` with exact base geometry:

```css
.today-checkin-panel {
    width: 278px;
    min-height: 289px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    border-radius: 24px;
    background: #fffdfbee;
    box-shadow: inset 0 0 0 1px #efdccd, 0 14px 28px rgba(91, 70, 54, 0.18);
    color: #5b4636;
    overflow: hidden;
}

.today-checkin-head,
.today-checkin-progress-meta,
.today-checkin-footer,
.today-checkin-item,
.today-checkin-item-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.today-checkin-title-wrap { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.today-checkin-title-wrap h2 { margin: 0; color: #5b4636; font-family: MaokenAssortedSans, sans-serif; font-size: 20px; font-weight: 700; }
.today-checkin-title-wrap p,
.today-checkin-progress-meta,
.today-checkin-footer { margin: 0; color: #a28b79; font-family: MaokenAssortedSans, sans-serif; font-size: 11px; font-weight: 700; }

.today-checkin-status {
    padding: 4px 8px;
    border-radius: 999px;
    background: #ffe5d9;
    color: #d15f3d;
    font-family: MaokenAssortedSans, sans-serif;
    font-size: 10px;
    font-weight: 700;
}

.today-checkin-progress { display: flex; flex-direction: column; gap: 6px; }
.today-checkin-progress-meta strong { color: #d15f3d; font-size: 11px; }
.today-checkin-track { height: 8px; border-radius: 999px; overflow: hidden; background: #f0e0d0; }
.today-checkin-track div { height: 100%; border-radius: inherit; background: #d15f3d; }
.today-checkin-list { display: flex; flex-direction: column; gap: 8px; }

.today-checkin-item {
    min-height: 44px;
    padding: 8px 10px;
    border: 1px solid #f0d3bc;
    border-radius: 14px;
    background: #fff7f0;
}

.today-checkin-item.done {
    border-color: #bbf7d0;
    background: #f0fdf4;
}

.today-checkin-item-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.today-checkin-item-copy strong { color: #5b4636; font-size: 13px; font-weight: 800; }
.today-checkin-item-copy span { color: #a28b79; font-size: 11px; font-weight: 700; }
.today-checkin-item-actions { gap: 6px; }
.today-checkin-item-actions span { padding: 4px 8px; border-radius: 999px; background: #ffe5d9; color: #d15f3d; font-size: 10px; font-weight: 700; }
.today-checkin-item-actions button { width: 28px; height: 28px; border-radius: 14px; background: #d15f3d; color: white; font-weight: 800; }
.today-checkin-item.done .today-checkin-item-actions span { background: #dcfce7; color: #34a853; }
.today-checkin-item.done .today-checkin-item-actions button { background: #e8f7ed; color: #34a853; border: 1px solid #bfe8ca; }

.today-checkin-rest {
    display: flex;
    min-height: 118px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid #a7f3d0;
    border-radius: 16px;
    background: #ecfdf3;
    text-align: center;
}

.today-checkin-rest span { color: #214e34; font-size: 17px; font-weight: 800; }
.today-checkin-rest p { width: 210px; margin: 0; color: #52745e; font-size: 12px; font-weight: 600; }
.today-checkin-footer button { padding: 6px 8px; border: 1px solid #efdccd; border-radius: 999px; background: #ffffffcc; color: #a28b79; font-size: 11px; font-weight: 700; }
.today-checkin-panel.is-complete .today-checkin-status,
.today-checkin-panel.is-rest .today-checkin-status { background: #dcfce7; color: #34a853; }
```

- [ ] **Step 5: Run Today panel tests**

Run:

```bash
cd app && npx vitest run src/ui/TodayCheckinPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add app/src/ui/TodayCheckinPanel.tsx app/src/ui/TodayCheckinPanel.css app/src/ui/TodayCheckinPanel.test.tsx
git commit -m "feat: add today checkin panel"
```

## Task 6: Check-in Plan Editor UI

**Files:**
- Create: `app/src/ui/CheckinPlanEditorPanel.tsx`
- Create: `app/src/ui/CheckinPlanEditorPanel.css`
- Create: `app/src/ui/CheckinPlanEditorPanel.test.tsx`

- [ ] **Step 1: Write failing editor tests**

Create `app/src/ui/CheckinPlanEditorPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCheckinStore } from '../domain/checkin';
import { CheckinPlanEditorPanel } from './CheckinPlanEditorPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve()) }));

describe('CheckinPlanEditorPanel', () => {
    beforeEach(() => {
        useCheckinStore.setState({
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: { kind: 'items', items: [{ id: 'read', title: '阅读', type: 'manual', targetCount: 2 }] },
                    tue: { kind: 'inherit' },
                    wed: { kind: 'inherit' },
                    thu: { kind: 'inherit' },
                    fri: { kind: 'inherit' },
                    sat: { kind: 'inherit' },
                    sun: { kind: 'rest' },
                },
            },
            dailyRecords: {},
            lastError: null,
        });
    });

    it('edits a local draft and saves explicitly', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '新增栏目' }));
        fireEvent.change(screen.getByLabelText('新栏目名称'), { target: { value: '喝水' } });
        fireEvent.click(screen.getByRole('button', { name: '保存计划' }));

        const monday = useCheckinStore.getState().weeklyPlan.days.mon;
        expect(monday.kind).toBe('items');
        if (monday.kind === 'items') {
            expect(monday.items.some((item) => item.title === '喝水')).toBe(true);
        }
    });

    it('rest toggle replaces item editor with rest state until switched off', () => {
        render(<CheckinPlanEditorPanel />);

        fireEvent.click(screen.getByRole('button', { name: '周三' }));
        fireEvent.click(screen.getByRole('switch', { name: '休息日' }));

        expect(screen.getByText('当天休息')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '新增栏目' })).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run editor tests and verify they fail**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the editor component**

Create `app/src/ui/CheckinPlanEditorPanel.tsx` with draft state:

```tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type CheckinDayPlan, type CheckinItem, type WeekdayKey, useCheckinStore } from '../domain/checkin';
import './CheckinPlanEditorPanel.css';

const WEEKDAYS: Array<[WeekdayKey, string]> = [
    ['mon', '一'], ['tue', '二'], ['wed', '三'], ['thu', '四'], ['fri', '五'], ['sat', '六'], ['sun', '日'],
];

function createItem(title = '新栏目'): CheckinItem {
    return {
        id: `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        title,
        type: 'manual',
        targetCount: 1,
    };
}

export function CheckinPlanEditorPanel() {
    const sourcePlan = useCheckinStore((s) => s.weeklyPlan);
    const setWeeklyPlan = useCheckinStore((s) => s.setWeeklyPlan);
    const [draft, setDraft] = useState(() => structuredClone(sourcePlan));
    const [selected, setSelected] = useState<WeekdayKey>('mon');
    const selectedPlan = draft.days[selected];
    const selectedItems = selectedPlan.kind === 'items' ? selectedPlan.items : [];

    const setSelectedPlan = (plan: CheckinDayPlan) => {
        setDraft((current) => ({
            ...current,
            days: { ...current.days, [selected]: plan },
        }));
    };

    const addItem = () => {
        const items = selectedPlan.kind === 'items' ? selectedPlan.items : [];
        setSelectedPlan({ kind: 'items', items: [...items, createItem()] });
    };

    const updateItemTitle = (id: string, title: string) => {
        if (selectedPlan.kind !== 'items') return;
        setSelectedPlan({
            kind: 'items',
            items: selectedPlan.items.map((item) => item.id === id ? { ...item, title } : item),
        });
    };

    const toggleRest = () => {
        setSelectedPlan(selectedPlan.kind === 'rest' ? { kind: 'inherit' } : { kind: 'rest' });
    };

    const save = () => {
        setWeeklyPlan(draft);
        void invoke('close_checkin_editor_window');
    };

    return (
        <div className="checkin-editor-panel">
            <div className="checkin-editor-header">
                <div>
                    <h2>本周计划</h2>
                    <p>点击上方星期切换当天计划；空白日期自动继承前一天内容</p>
                </div>
                <span>按日编辑</span>
            </div>

            <section className="checkin-editor-card">
                <div className="checkin-editor-card-head">
                    <strong>选择日期</strong>
                    <span>点击星期切换到当天计划；绿色表示已完成或休息</span>
                </div>
                <div className="checkin-editor-week-grid">
                    {WEEKDAYS.map(([key, label]) => (
                        <button key={key} className={selected === key ? 'active' : ''} aria-label={`周${label}`} onClick={() => setSelected(key)}>
                            {label}
                        </button>
                    ))}
                </div>
            </section>

            <section className="checkin-editor-card">
                <div className="checkin-editor-selected-row">
                    <div>
                        <strong>周{WEEKDAYS.find(([key]) => key === selected)?.[1]}计划</strong>
                        <p>{selectedPlan.kind === 'rest' ? '当天不会生成打卡项目' : '未填写时会继承前一天内容'}</p>
                    </div>
                    <button role="switch" aria-label="休息日" aria-checked={selectedPlan.kind === 'rest'} onClick={toggleRest}>
                        休息日：{selectedPlan.kind === 'rest' ? '开' : '关'}
                    </button>
                </div>
            </section>

            <section className="checkin-editor-card checkin-editor-content-card">
                {selectedPlan.kind === 'rest' ? (
                    <div className="checkin-editor-rest-state">
                        <span>当天休息</span>
                        <p>今天不计入本周目标，所有打卡项目在当天隐藏。</p>
                    </div>
                ) : (
                    <>
                        <div className="checkin-editor-items-head">
                            <div><strong>打卡项目</strong><p>新增时先选择番茄钟或通用；通用标题可编辑</p></div>
                            <button onClick={addItem}>新增栏目</button>
                        </div>
                        <div className="checkin-editor-items">
                            {selectedItems.map((item, index) => (
                                <label key={item.id} className="checkin-editor-item-row">
                                    <span>{item.type === 'pomodoroFocus' ? '番茄钟' : '通用'}</span>
                                    <input aria-label={index === 0 ? '新栏目名称' : `${item.title} 名称`} value={item.title} onChange={(e) => updateItemTitle(item.id, e.target.value)} />
                                    <span>{item.targetCount} 次</span>
                                </label>
                            ))}
                        </div>
                    </>
                )}
            </section>

            <section className="checkin-editor-advanced">
                <div><strong>下周沿用当前计划</strong><p>保存后作为当前激活计划的下周默认配置</p></div>
                <button aria-pressed={draft.carryToNextWeek} onClick={() => setDraft((current) => ({ ...current, carryToNextWeek: !current.carryToNextWeek }))}>
                    {draft.carryToNextWeek ? '开' : '关'}
                </button>
            </section>

            <div className="checkin-editor-actions">
                <button onClick={() => void invoke('close_checkin_editor_window')}>取消</button>
                <button onClick={save}>保存计划</button>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Implement editor CSS**

Create `app/src/ui/CheckinPlanEditorPanel.css`:

```css
.checkin-editor-panel {
    width: 460px;
    max-height: min(898px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    overflow: auto;
    border-radius: 24px;
    background: #fffdfbee;
    box-shadow: inset 0 0 0 1px #efdccd, 0 18px 36px rgba(91, 70, 54, 0.16);
    color: #5b4636;
}

.checkin-editor-header,
.checkin-editor-card-head,
.checkin-editor-selected-row,
.checkin-editor-items-head,
.checkin-editor-advanced,
.checkin-editor-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.checkin-editor-header h2 { margin: 0; color: #5b4636; font-size: 20px; font-weight: 700; }
.checkin-editor-header p,
.checkin-editor-card p,
.checkin-editor-advanced p { margin: 0; color: #6b7280; font-size: 12px; font-weight: 600; }
.checkin-editor-header span { padding: 6px 10px; border-radius: 999px; background: #fff1ee; color: #d15f3d; font-size: 12px; font-weight: 800; }

.checkin-editor-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    border: 1px solid #efdccd;
    border-radius: 18px;
    background: #ffffffb8;
}

.checkin-editor-week-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
}

.checkin-editor-week-grid button {
    padding: 8px 6px;
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    background: #ffffffcc;
    color: #5b4636;
    font-weight: 800;
}

.checkin-editor-week-grid button.active { border-color: #d15f3d; background: #fff1ee; color: #d15f3d; }
.checkin-editor-selected-row button,
.checkin-editor-items-head button,
.checkin-editor-actions button,
.checkin-editor-advanced button { border-radius: 999px; padding: 7px 10px; font-weight: 800; }
.checkin-editor-items-head button,
.checkin-editor-actions button:last-child { background: #d15f3d; color: white; }
.checkin-editor-content-card { min-height: 300px; }
.checkin-editor-items { display: flex; flex-direction: column; gap: 8px; }
.checkin-editor-item-row { display: flex; align-items: center; gap: 8px; padding: 10px; border: 1px solid #f0e0d0; border-radius: 14px; background: #fffdfbe6; }
.checkin-editor-item-row input { min-width: 0; flex: 1; border: 1px solid #e5e7eb; border-radius: 12px; padding: 6px 8px; background: #ffffffcc; color: #5b4636; }
.checkin-editor-rest-state { display: flex; min-height: 139px; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 1px solid #a7f3d0; border-radius: 16px; background: #ecfdf3; text-align: center; }
.checkin-editor-rest-state span { color: #214e34; font-size: 17px; font-weight: 800; }
.checkin-editor-rest-state p { width: 300px; color: #52745e; }
.checkin-editor-advanced { padding: 10px 12px; border: 1px solid #efdccd; border-radius: 18px; background: #fff7f0; }
.checkin-editor-actions { justify-content: flex-end; padding: 4px 0; }
```

- [ ] **Step 5: Run editor tests**

Run:

```bash
cd app && npx vitest run src/ui/CheckinPlanEditorPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add app/src/ui/CheckinPlanEditorPanel.tsx app/src/ui/CheckinPlanEditorPanel.css app/src/ui/CheckinPlanEditorPanel.test.tsx
git commit -m "feat: add checkin plan editor"
```

## Task 7: Pomodoro Completion Integration

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/domain/checkin.test.ts`
- Create: `app/src/checkinPomodoroIntegration.test.tsx`

- [ ] **Step 1: Write failing integration test**

Create `app/src/checkinPomodoroIntegration.test.tsx`:

```tsx
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { useCheckinStore } from './domain/checkin';
import { usePomodoroStore } from './domain/pomodoro';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: { getByLabel: vi.fn(() => Promise.resolve(null)) } }));

describe('checkin Pomodoro integration', () => {
    it('increments today pomodoroFocus items once per focus end event', () => {
        vi.setSystemTime(new Date('2026-05-19T10:00:00+08:00'));
        useCheckinStore.setState({
            weeklyPlan: {
                weekStartDate: '2026-05-18',
                carryToNextWeek: true,
                days: {
                    mon: { kind: 'inherit' },
                    tue: { kind: 'items', items: [{ id: 'pomo', title: '专注番茄', type: 'pomodoroFocus', targetCount: 2 }] },
                    wed: { kind: 'rest' },
                    thu: { kind: 'inherit' },
                    fri: { kind: 'inherit' },
                    sat: { kind: 'inherit' },
                    sun: { kind: 'rest' },
                },
            },
            dailyRecords: {},
            lastError: null,
        });

        render(<App />);

        act(() => {
            usePomodoroStore.setState({
                lastEndEvent: { id: 9, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
            });
        });
        act(() => {
            usePomodoroStore.setState({
                lastEndEvent: { id: 9, fromPhase: 'focus', toPhase: 'break', triggeredBy: 'timer' },
            });
        });

        expect(useCheckinStore.getState().dailyRecords['2026-05-19'].countsByItemId.pomo).toBe(1);
    });
});
```

- [ ] **Step 2: Run integration test and verify it fails**

Run:

```bash
cd app && npx vitest run src/checkinPomodoroIntegration.test.tsx
```

Expected: FAIL because `App` does not process Pomodoro end events into check-in records.

- [ ] **Step 3: Add App effect for Pomodoro end events**

In `app/src/App.tsx`, import `useCheckinStore` if Task 2 did not already do so. Reuse the `todayLocalDate()` helper added during persistence hydration.

Add this effect inside `App`:

```tsx
useEffect(() => {
    return usePomodoroStore.subscribe((state, previous) => {
        const event = state.lastEndEvent;
        if (!event || event === previous.lastEndEvent) return;
        if (event.fromPhase !== 'focus') return;
        useCheckinStore.getState().applyPomodoroFocusCompletion(todayLocalDate(), event.id);
    });
}, []);
```

Keep the idempotency in the check-in store as the final guard.

- [ ] **Step 4: Mount check-in window controller**

In `app/src/App.tsx`, import and call:

```ts
import { useCheckinWindowController } from './domain/checkinWindow';
```

Inside `App`:

```tsx
useCheckinWindowController();
```

- [ ] **Step 5: Run integration and domain tests**

Run:

```bash
cd app && npx vitest run src/checkinPomodoroIntegration.test.tsx src/domain/checkin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add app/src/App.tsx app/src/checkinPomodoroIntegration.test.tsx app/src/domain/checkin.test.ts
git commit -m "feat: link pomodoro completion to checkins"
```

## Task 8: Verification and Visual QA

**Files:**
- Inspect: `app/src/ui/TodayCheckinPanel.css`
- Inspect: `app/src/ui/CheckinPlanEditorPanel.css`

- [ ] **Step 1: Run focused test suite**

Run:

```bash
cd app && npx vitest run \
  src/domain/checkin.test.ts \
  src/domain/checkinPersistence.test.ts \
  src/domain/bridge/protocol.test.ts \
  src/domain/bridge/host.test.ts \
  src/domain/bridge/client.test.ts \
  src/checkinWindowConfig.test.ts \
  src/ui/TodayCheckinPanel.test.tsx \
  src/ui/CheckinPlanEditorPanel.test.tsx \
  src/checkinPomodoroIntegration.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full frontend tests**

Run:

```bash
cd app && npm test
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
cd app && npm run build
```

Expected: PASS with Vite build output.

- [ ] **Step 4: Run Rust check**

Run:

```bash
cd app/src-tauri && cargo check
```

Expected: PASS.

- [ ] **Step 5: Launch the local app for visual comparison**

Run:

```bash
./start.sh
```

Expected: Tauri dev app opens. Confirm:

- `today-checkin` window appears as a compact 278px panel.
- Clicking `编辑` opens the 460px editor window.
- Both windows stay visually close to Pencil `g9Gei`.
- UI scale changes resize both windows.
- Completing a focus Pomodoro increments today's `pomodoroFocus` item once.

- [ ] **Step 6: Capture screenshots for review**

Use browser or OS screenshots to capture:

- Today incomplete state.
- Today complete state.
- Today rest state.
- Editor ordinary state.
- Editor rest state.

Save temporary screenshots under `/tmp` and do not commit them.

- [ ] **Step 7: Commit visual polish fixes when visual QA changes CSS**

```bash
git add app/src/ui/TodayCheckinPanel.css app/src/ui/CheckinPlanEditorPanel.css
git commit -m "fix: polish checkin panel visuals"
```

Run `git status --short` before this step. When there are no CSS changes, record that result in the implementation notes and do not create an empty commit.

## Final Verification

- [ ] Run `cd app && npm test`.
- [ ] Run `cd app && npm run build`.
- [ ] Run `cd app/src-tauri && cargo check`.
- [ ] Run `./start.sh` and manually verify both check-in windows.
- [ ] Confirm `git status --short` contains only intentional files.
