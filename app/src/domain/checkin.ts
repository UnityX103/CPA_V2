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

export interface CheckinStreakSummary {
    currentStreak: number;
    checkedThroughDate: string;
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

export function effectivePlanForDate(state: CheckinState, date: string): CheckinDayPlan {
    const plan = state.weeklyPlan.days[weekdayForDate(date)];
    if (plan.kind !== 'inherit') return plan;

    let cursor = date;
    for (let i = 0; i < WEEKDAYS.length; i += 1) {
        cursor = addDays(cursor, -1);
        const previousPlan = state.weeklyPlan.days[weekdayForDate(cursor)];
        if (previousPlan.kind === 'items') return previousPlan;
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
    const summaries = WEEKDAYS.map((_, index) => dailySummary(state, addDays(weekStartDate, index)));
    const activeSummaries = summaries.filter((summary) => !summary.isRestDay);
    const completedCount = activeSummaries.reduce((sum, summary) => sum + summary.completedCount, 0);
    const totalTarget = activeSummaries.reduce((sum, summary) => sum + summary.totalTarget, 0);

    return {
        weekStartDate,
        restDays: summaries.filter((summary) => summary.isRestDay).map((summary) => summary.date),
        completedCount,
        totalTarget,
        completionRate: totalTarget === 0 ? 1 : completedCount / totalTarget,
    };
}

export function streakSummary(state: CheckinState, today: string): CheckinStreakSummary {
    let currentStreak = 0;
    let checkedThroughDate = today;
    const recordedDates = Object.keys(state.dailyRecords);
    const lowerBound = recordedDates.reduce(
        (earliest, date) => date < earliest ? date : earliest,
        state.weeklyPlan.weekStartDate,
    );

    for (let date = today; date >= lowerBound; date = addDays(date, -1)) {
        const summary = dailySummary(state, date);
        if (summary.isRestDay) {
            if (date === checkedThroughDate) checkedThroughDate = addDays(date, -1);
            continue;
        }
        if (summary.completionRate !== 1) break;

        if (currentStreak === 0) checkedThroughDate = date;
        currentStreak += 1;
    }

    return { currentStreak, checkedThroughDate };
}

export function createCheckinStore(opts: { isMirrorWindow: boolean }): CheckinStore {
    if (opts.isMirrorWindow) {
        return create<CheckinState & CheckinActions>((set) => ({
            weeklyPlan: defaultWeeklyPlan(currentWeekStart()),
            dailyRecords: {},
            lastError: null,
            setWeeklyPlan: (plan) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'checkin', action: 'setWeeklyPlan', args: [plan] });
            },
            incrementItem: (date, itemId) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'checkin', action: 'incrementItem', args: [date, itemId] });
            },
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

            const countsByItemId = { ...record.countsByItemId };
            for (const item of effectiveItemsForDate(state, date)) {
                if (item.type === 'pomodoroFocus') {
                    countsByItemId[item.id] = (countsByItemId[item.id] ?? 0) + 1;
                }
            }

            return {
                dailyRecords: {
                    ...state.dailyRecords,
                    [date]: {
                        ...record,
                        countsByItemId,
                        processedPomodoroEndEventIds: [
                            ...record.processedPomodoroEndEventIds,
                            endEventId,
                        ],
                    },
                },
            };
        }),
        rollForwardToDate: (date) => {
            const current = get().weeklyPlan;
            const nextWeekStart = weekStartForDate(date);
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

export const useCheckinStore: CheckinStore = createCheckinStore({
    isMirrorWindow: detectMirrorWindow(),
});
