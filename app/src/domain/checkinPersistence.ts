import {
    migrateWeeklyPlanToTemplate,
    normalizePlanTemplate,
    type CheckinDayPlan,
    type CheckinPlanTemplate,
    type DailyCheckinRecord,
    type LegacyCheckinItem,
    type WeekdayKey,
    type WeeklyCheckinPlan,
} from './checkin';

export const STORAGE_KEY = 'cpa-v2-checkin-v1';
const WEEKDAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface PersistedCheckinSnapshot {
    schemaVersion: 2;
    planTemplate: CheckinPlanTemplate;
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

function normalizeLegacyItem(value: unknown): LegacyCheckinItem | null {
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
    return {
        id: value.id,
        title: value.title,
        type: value.type,
        targetCount: Math.max(1, Math.floor(value.targetCount)),
        ...(typeof value.icon === 'string' ? { icon: value.icon as LegacyCheckinItem['icon'] } : {}),
        ...(typeof value.perUseAmount === 'number' && Number.isFinite(value.perUseAmount)
            ? { perUseAmount: Math.max(0, value.perUseAmount) }
            : {}),
        ...(typeof value.perUseUnit === 'string' && value.perUseUnit.trim()
            ? { perUseUnit: value.perUseUnit.trim() }
            : {}),
    };
}

function normalizeDayPlan(value: unknown): CheckinDayPlan | null {
    if (!isObject(value)) return null;
    if (value.kind === 'inherit' || value.kind === 'rest') return { kind: value.kind };
    if (value.kind !== 'items' || !Array.isArray(value.items)) return null;
    const items = value.items.map(normalizeLegacyItem);
    if (items.some((item) => item === null)) return null;
    return { kind: 'items', items: items as LegacyCheckinItem[] };
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

function normalizeDailyRecord(value: unknown): DailyCheckinRecord | null {
    if (!isObject(value) || !isObject(value.countsByItemId) || typeof value.date !== 'string') return null;
    return {
        date: value.date,
        countsByItemId: Object.fromEntries(
            Object.entries(value.countsByItemId)
                .filter(([, count]) => typeof count === 'number' && Number.isFinite(count))
                .map(([id, count]) => [id, Math.max(0, count as number)]),
        ),
        processedPomodoroEndEventIds: Array.isArray(value.processedPomodoroEndEventIds)
            ? value.processedPomodoroEndEventIds.filter((id): id is number => (
                typeof id === 'number' && Number.isInteger(id)
            ))
            : [],
    };
}

function normalizeDailyRecords(value: unknown): Record<string, DailyCheckinRecord> | null {
    if (!isObject(value)) return null;
    const records: Record<string, DailyCheckinRecord> = {};
    for (const [date, record] of Object.entries(value)) {
        const normalized = normalizeDailyRecord(record);
        if (!normalized) return null;
        records[date] = normalized;
    }
    return records;
}

function normalizePersistedCheckinSnapshot(value: unknown): PersistedCheckinSnapshot | null {
    if (!isObject(value)) return null;
    const dailyRecords = normalizeDailyRecords(value.dailyRecords);
    if (!dailyRecords) return null;

    if (value.schemaVersion === 2) {
        const planTemplate = normalizePlanTemplate(value.planTemplate);
        return planTemplate ? { schemaVersion: 2, planTemplate, dailyRecords } : null;
    }

    if (value.schemaVersion === 1) {
        const weeklyPlan = normalizeWeeklyPlan(value.weeklyPlan);
        return weeklyPlan
            ? { schemaVersion: 2, planTemplate: migrateWeeklyPlanToTemplate(weeklyPlan), dailyRecords }
            : null;
    }

    return null;
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
