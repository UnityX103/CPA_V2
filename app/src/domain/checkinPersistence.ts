import type {
    CheckinDayPlan,
    CheckinItem,
    CheckinItemIcon,
    DailyCheckinRecord,
    WeekdayKey,
    WeeklyCheckinPlan,
} from './checkin';

export const STORAGE_KEY = 'cpa-v2-checkin-v1';
const CHECKIN_ITEM_ICONS = [
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
] satisfies CheckinItemIcon[];
const CHECKIN_ITEM_ICON_SET = new Set<string>(CHECKIN_ITEM_ICONS);
const WEEKDAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface PersistedCheckinSnapshot {
    schemaVersion: 1;
    weeklyPlan: WeeklyCheckinPlan;
    dailyRecords: Record<string, DailyCheckinRecord>;
}

function getStorage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeIcon(value: unknown): CheckinItemIcon | undefined {
    return typeof value === 'string' && CHECKIN_ITEM_ICON_SET.has(value)
        ? value as CheckinItemIcon
        : undefined;
}

function normalizePerUseAmount(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.max(0, value);
}

function normalizePerUseUnit(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : '次';
}

function normalizeCheckinItem(value: unknown): CheckinItem | null {
    if (!isObject(value)) return null;
    if (
        typeof value.id !== 'string'
        || typeof value.title !== 'string'
        || (value.type !== 'manual' && value.type !== 'pomodoroFocus')
        || typeof value.targetCount !== 'number'
        || !Number.isFinite(value.targetCount)
    ) {
        return null;
    }

    const icon = normalizeIcon(value.icon);
    const perUseAmount = normalizePerUseAmount(value.perUseAmount);
    const perUseUnit = normalizePerUseUnit(value.perUseUnit);
    return {
        id: value.id,
        title: value.title,
        type: value.type,
        targetCount: Math.max(1, value.targetCount),
        ...(icon ? { icon } : {}),
        ...(perUseAmount !== undefined ? { perUseAmount } : {}),
        ...(perUseUnit !== undefined ? { perUseUnit } : {}),
    };
}

function normalizeDayPlan(value: unknown): CheckinDayPlan | null {
    if (!isObject(value)) return null;
    if (value.kind === 'inherit' || value.kind === 'rest') return { kind: value.kind };
    if (value.kind !== 'items' || !Array.isArray(value.items)) return null;

    const items = value.items.map(normalizeCheckinItem);
    if (items.some((item) => item === null)) return null;
    return { kind: 'items', items: items as CheckinItem[] };
}

function normalizeWeeklyPlan(value: unknown): WeeklyCheckinPlan | null {
    if (!isObject(value) || !isObject(value.days)) return null;
    if (typeof value.weekStartDate !== 'string' || typeof value.carryToNextWeek !== 'boolean') {
        return null;
    }

    const normalizedDays = {} as WeeklyCheckinPlan['days'];
    for (const day of WEEKDAYS) {
        const normalizedPlan = normalizeDayPlan(value.days[day]);
        if (!normalizedPlan) return null;
        normalizedDays[day] = normalizedPlan;
    }

    return {
        weekStartDate: value.weekStartDate,
        carryToNextWeek: value.carryToNextWeek,
        days: normalizedDays,
    };
}

function isDailyRecord(value: unknown): value is DailyCheckinRecord {
    if (!isObject(value) || !isObject(value.countsByItemId)) return false;
    return typeof value.date === 'string'
        && Object.values(value.countsByItemId).every((count) => (
            typeof count === 'number' && Number.isFinite(count)
        ))
        && Array.isArray(value.processedPomodoroEndEventIds)
        && value.processedPomodoroEndEventIds.every((id) => (
            typeof id === 'number' && Number.isFinite(id)
        ));
}

function isDailyRecords(value: unknown): value is Record<string, DailyCheckinRecord> {
    return isObject(value) && Object.values(value).every(isDailyRecord);
}

function normalizePersistedCheckinSnapshot(value: unknown): PersistedCheckinSnapshot | null {
    if (!isObject(value) || value.schemaVersion !== 1 || !isDailyRecords(value.dailyRecords)) return null;
    const weeklyPlan = normalizeWeeklyPlan(value.weeklyPlan);
    if (!weeklyPlan) return null;
    return {
        schemaVersion: 1,
        weeklyPlan,
        dailyRecords: value.dailyRecords,
    };
}

export async function loadPersistedCheckin(): Promise<PersistedCheckinSnapshot | null> {
    const storage = getStorage();
    if (!storage) return null;

    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return normalizePersistedCheckinSnapshot(parsed);
    } catch {
        return null;
    }
}

export async function savePersistedCheckin(snapshot: PersistedCheckinSnapshot): Promise<void> {
    const storage = getStorage();
    if (!storage) return;

    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}
