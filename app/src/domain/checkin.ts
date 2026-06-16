import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { dispatch } from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

export type CheckinItemType = 'manual' | 'pomodoroFocus';
export type CheckinItemIcon =
    | 'activity'
    | 'dumbbell'
    | 'bookOpen'
    | 'droplet'
    | 'listChecks'
    | 'sparkle'
    | 'coffee'
    | 'moon'
    | 'sun'
    | 'leaf'
    | 'music'
    | 'pencil'
    | 'target'
    | 'flame'
    | 'heart'
    | 'apple'
    | 'clock'
    | 'meditation';
export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type CheckinRepeatDay = WeekdayKey;
export type CheckinEditMode = 'cycle' | 'count';

export interface LegacyCheckinItem {
    id: string;
    title: string;
    type: CheckinItemType;
    targetCount: number;
    icon?: CheckinItemIcon;
    perUseAmount?: number;
    perUseUnit?: string;
}

export interface CheckinPlanItem extends LegacyCheckinItem {
    repeatDays: CheckinRepeatDay[];
    editMode: CheckinEditMode;
    countInputValue?: number;
    countUnitSize?: number;
    countUnitLabel?: string;
    countLoopCount?: number;
}

export type CheckinItem = CheckinPlanItem;

export type CheckinDayPlan =
    | { kind: 'inherit' }
    | { kind: 'rest' }
    | { kind: 'items'; items: LegacyCheckinItem[] };

export interface WeeklyCheckinPlan {
    weekStartDate: string;
    days: Record<WeekdayKey, CheckinDayPlan>;
    carryToNextWeek: boolean;
}

export interface CheckinPlanTemplate {
    schemaVersion: 2;
    items: CheckinPlanItem[];
    carryToNextWeek: boolean;
}

export interface DailyCheckinRecord {
    date: string;
    countsByItemId: Record<string, number>;
    processedPomodoroEndEventIds: number[];
}

export interface CheckinSummary {
    date: string;
    isNoPlanDay: boolean;
    completedCount: number;
    totalTarget: number;
    completionRate: number;
}

export interface WeeklyCheckinSummary {
    weekStartDate: string;
    noPlanDays: string[];
    completedCount: number;
    totalTarget: number;
    completionRate: number;
}

export interface CheckinStreakSummary {
    currentStreak: number;
    checkedThroughDate: string;
}

export interface CheckinState {
    planTemplate: CheckinPlanTemplate;
    dailyRecords: Record<string, DailyCheckinRecord>;
    lastError: string | null;
}

export interface CheckinActions {
    setPlanTemplate: (template: CheckinPlanTemplate) => void;
    incrementItem: (date: string, itemId: string) => void;
    applyPomodoroFocusCompletion: (date: string, endEventId: number) => void;
    rollForwardToDate: (date: string) => void;
    hydrateCheckin: (snapshot: Pick<CheckinState, 'planTemplate' | 'dailyRecords'>) => void;
    setLastError: (message: string | null) => void;
}

export type CheckinStore = UseBoundStore<StoreApi<CheckinState & CheckinActions>>;

export const WEEKDAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_SET = new Set<WeekdayKey>(WEEKDAYS);
const CHECKIN_ITEM_ICON_SET = new Set<CheckinItemIcon>([
    'activity',
    'dumbbell',
    'bookOpen',
    'droplet',
    'listChecks',
    'sparkle',
    'coffee',
    'moon',
    'sun',
    'leaf',
    'music',
    'pencil',
    'target',
    'flame',
    'heart',
    'apple',
    'clock',
    'meditation',
]);

export function weekdayForDate(date: string): WeekdayKey {
    const day = new Date(`${date}T12:00:00`).getDay();
    return WEEKDAYS[(day + 6) % 7];
}

export function addDays(date: string, offset: number): string {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
}

function currentWeekStart(date = new Date()): string {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    const diff = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diff);
    return d.toISOString().slice(0, 10);
}

function emptyRecord(date: string): DailyCheckinRecord {
    return { date, countsByItemId: {}, processedPomodoroEndEventIds: [] };
}

export function defaultPlanTemplate(): CheckinPlanTemplate {
    return {
        schemaVersion: 2,
        carryToNextWeek: true,
        items: [{
            id: 'pomodoro-focus',
            title: '专注番茄',
            type: 'pomodoroFocus',
            targetCount: 4,
            icon: 'clock',
            repeatDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
            editMode: 'cycle',
            perUseAmount: 25,
            perUseUnit: '分钟',
            countInputValue: 4,
            countUnitSize: 4,
            countUnitLabel: '次',
            countLoopCount: 1,
        }],
    };
}

export function defaultWeeklyPlan(weekStartDate: string): WeeklyCheckinPlan {
    return {
        weekStartDate,
        carryToNextWeek: true,
        days: {
            mon: {
                kind: 'items',
                items: [{
                    id: 'pomodoro-focus',
                    title: '专注番茄',
                    type: 'pomodoroFocus',
                    targetCount: 4,
                    icon: 'clock',
                    perUseAmount: 25,
                    perUseUnit: '分钟',
                }],
            },
            tue: { kind: 'inherit' },
            wed: { kind: 'inherit' },
            thu: { kind: 'inherit' },
            fri: { kind: 'inherit' },
            sat: { kind: 'inherit' },
            sun: { kind: 'rest' },
        },
    };
}

function legacyEffectiveItemsForDay(plan: WeeklyCheckinPlan, day: WeekdayKey): LegacyCheckinItem[] {
    const explicit = plan.days[day];
    if (explicit.kind === 'items') return explicit.items;
    if (explicit.kind === 'rest') return [];

    let index = WEEKDAYS.indexOf(day);
    for (let i = 0; i < WEEKDAYS.length; i += 1) {
        index = (index + WEEKDAYS.length - 1) % WEEKDAYS.length;
        const previous = plan.days[WEEKDAYS[index]];
        if (previous.kind === 'items') return previous.items;
    }

    return [];
}

function legacyItemGroupKey(item: LegacyCheckinItem): string {
    return JSON.stringify({
        title: item.title,
        type: item.type,
        targetCount: item.targetCount,
        icon: item.icon ?? null,
        perUseAmount: item.perUseAmount ?? null,
        perUseUnit: item.perUseUnit ?? null,
    });
}

function uniqueItemId(baseId: string, used: Set<string>): string {
    if (!used.has(baseId)) {
        used.add(baseId);
        return baseId;
    }
    let index = 2;
    while (used.has(`${baseId}-${index}`)) index += 1;
    const next = `${baseId}-${index}`;
    used.add(next);
    return next;
}

export function migrateWeeklyPlanToTemplate(plan: WeeklyCheckinPlan): CheckinPlanTemplate {
    const groups = new Map<string, CheckinPlanItem>();
    const usedIds = new Set<string>();

    for (const day of WEEKDAYS) {
        if (plan.days[day].kind === 'rest') continue;
        for (const item of legacyEffectiveItemsForDay(plan, day)) {
            const key = legacyItemGroupKey(item);
            const existing = groups.get(key);
            if (existing) {
                if (!existing.repeatDays.includes(day)) {
                    existing.repeatDays.push(day);
                }
                continue;
            }

            groups.set(key, {
                ...item,
                id: uniqueItemId(item.id, usedIds),
                repeatDays: [day],
                editMode: 'cycle',
                countInputValue: item.targetCount,
                countUnitSize: item.targetCount,
                countUnitLabel: '次',
                countLoopCount: 1,
            });
        }
    }

    return {
        schemaVersion: 2,
        carryToNextWeek: plan.carryToNextWeek,
        items: Array.from(groups.values()).map((item) => ({
            ...item,
            repeatDays: WEEKDAYS.filter((day) => item.repeatDays.includes(day)),
        })),
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function normalizeNonNegativeNumber(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.max(0, value);
}

function normalizeNonEmptyString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeIcon(value: unknown): CheckinItemIcon | undefined {
    return typeof value === 'string' && CHECKIN_ITEM_ICON_SET.has(value as CheckinItemIcon)
        ? value as CheckinItemIcon
        : undefined;
}

function normalizeRepeatDays(value: unknown): CheckinRepeatDay[] {
    if (!Array.isArray(value)) return [];
    const result: CheckinRepeatDay[] = [];
    for (const day of value) {
        if (typeof day === 'string' && WEEKDAY_SET.has(day as WeekdayKey) && !result.includes(day as WeekdayKey)) {
            result.push(day as WeekdayKey);
        }
    }
    return result;
}

export function normalizePlanTemplateItem(value: unknown): CheckinPlanItem | null {
    if (!isObject(value) || typeof value.id !== 'string' || !value.id) return null;
    if (value.type !== 'manual' && value.type !== 'pomodoroFocus') return null;

    const icon = normalizeIcon(value.icon);
    const perUseAmount = normalizeNonNegativeNumber(value.perUseAmount);
    const perUseUnit = value.perUseUnit === undefined
        ? undefined
        : normalizeNonEmptyString(value.perUseUnit, '次');
    const countInputValue = value.countInputValue === undefined
        ? undefined
        : normalizeNonNegativeInteger(value.countInputValue, 0);
    const countUnitSize = value.countUnitSize === undefined
        ? undefined
        : normalizePositiveInteger(value.countUnitSize, 1);
    const countUnitLabel = value.countUnitLabel === undefined
        ? undefined
        : normalizeNonEmptyString(value.countUnitLabel, '次');
    const countLoopCount = value.countLoopCount === undefined
        ? undefined
        : normalizePositiveInteger(value.countLoopCount, 1);
    const type = value.type;

    return {
        id: value.id,
        title: normalizeNonEmptyString(value.title, type === 'pomodoroFocus' ? '专注番茄' : '新项目'),
        type,
        targetCount: normalizePositiveInteger(value.targetCount, 1),
        repeatDays: normalizeRepeatDays(value.repeatDays),
        editMode: value.editMode === 'count' ? 'count' : 'cycle',
        ...(icon ? { icon } : {}),
        ...(perUseAmount !== undefined ? { perUseAmount } : {}),
        ...(perUseUnit !== undefined ? { perUseUnit } : {}),
        ...(countInputValue !== undefined ? { countInputValue } : {}),
        ...(countUnitSize !== undefined ? { countUnitSize } : {}),
        ...(countUnitLabel !== undefined ? { countUnitLabel } : {}),
        ...(countLoopCount !== undefined ? { countLoopCount } : {}),
    };
}

export function normalizePlanTemplate(value: unknown): CheckinPlanTemplate | null {
    if (!isObject(value) || value.schemaVersion !== 2 || !Array.isArray(value.items)) return null;
    const items = value.items.map(normalizePlanTemplateItem);
    if (items.some((item) => item === null)) return null;
    return {
        schemaVersion: 2,
        carryToNextWeek: typeof value.carryToNextWeek === 'boolean' ? value.carryToNextWeek : true,
        items: items as CheckinPlanItem[],
    };
}

export function clonePlanTemplate(template: CheckinPlanTemplate): CheckinPlanTemplate {
    return {
        schemaVersion: 2,
        carryToNextWeek: template.carryToNextWeek,
        items: template.items.map((item) => ({
            ...item,
            repeatDays: [...item.repeatDays],
        })),
    };
}

export function itemsForDate(state: CheckinState, date: string): CheckinPlanItem[] {
    const weekday = weekdayForDate(date);
    return state.planTemplate.items.filter((item) => item.repeatDays.includes(weekday));
}

export const effectiveItemsForDate = itemsForDate;

export function isNoPlanDate(state: CheckinState, date: string): boolean {
    return itemsForDate(state, date).length === 0;
}

export const isRestDate = isNoPlanDate;

export function recordForDate(state: CheckinState, date: string): DailyCheckinRecord {
    return state.dailyRecords[date] ?? emptyRecord(date);
}

export function dailySummary(state: CheckinState, date: string): CheckinSummary {
    const record = recordForDate(state, date);
    const items = itemsForDate(state, date);
    const totalTarget = items.reduce((sum, item) => sum + item.targetCount, 0);
    const completedCount = items.reduce(
        (sum, item) => sum + Math.min(record.countsByItemId[item.id] ?? 0, item.targetCount),
        0,
    );

    return {
        date,
        isNoPlanDay: items.length === 0,
        completedCount,
        totalTarget,
        completionRate: totalTarget === 0 ? 1 : completedCount / totalTarget,
    };
}

export function weeklySummary(state: CheckinState, weekStartDate: string): WeeklyCheckinSummary {
    const summaries = WEEKDAYS.map((_, index) => dailySummary(state, addDays(weekStartDate, index)));
    const completedCount = summaries.reduce((sum, summary) => sum + summary.completedCount, 0);
    const totalTarget = summaries.reduce((sum, summary) => sum + summary.totalTarget, 0);

    return {
        weekStartDate,
        noPlanDays: summaries.filter((summary) => summary.isNoPlanDay).map((summary) => summary.date),
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
        currentWeekStart(new Date(`${today}T12:00:00`)),
    );

    for (let date = today; date >= lowerBound; date = addDays(date, -1)) {
        const summary = dailySummary(state, date);
        if (summary.completionRate !== 1) break;
        checkedThroughDate = date;
        currentStreak += 1;
    }

    return { currentStreak, checkedThroughDate };
}

export function createCheckinStore(opts: { isMirrorWindow: boolean }): CheckinStore {
    if (opts.isMirrorWindow) {
        return create<CheckinState & CheckinActions>((set) => ({
            planTemplate: defaultPlanTemplate(),
            dailyRecords: {},
            lastError: null,
            setPlanTemplate: (planTemplate) => {
                void dispatch({ v: BRIDGE_VERSION, store: 'checkin', action: 'setPlanTemplate', args: [planTemplate] });
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

    return create<CheckinState & CheckinActions>((set) => ({
        planTemplate: defaultPlanTemplate(),
        dailyRecords: {},
        lastError: null,
        setPlanTemplate: (planTemplate) => set({ planTemplate }),
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
            for (const item of itemsForDate(state, date)) {
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
        rollForwardToDate: () => {},
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
