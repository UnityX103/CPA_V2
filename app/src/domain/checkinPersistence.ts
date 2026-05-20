import type { DailyCheckinRecord, WeeklyCheckinPlan } from './checkin';

export const STORAGE_KEY = 'cpa-v2-checkin-v1';

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

function isCheckinItem(value: unknown): boolean {
    if (!isObject(value)) return false;
    return typeof value.id === 'string'
        && typeof value.title === 'string'
        && (value.type === 'manual' || value.type === 'pomodoroFocus')
        && typeof value.targetCount === 'number'
        && Number.isFinite(value.targetCount);
}

function isDayPlan(value: unknown): boolean {
    if (!isObject(value)) return false;
    if (value.kind === 'inherit' || value.kind === 'rest') return true;
    return value.kind === 'items'
        && Array.isArray(value.items)
        && value.items.every(isCheckinItem);
}

function isWeeklyPlan(value: unknown): value is WeeklyCheckinPlan {
    if (!isObject(value) || !isObject(value.days)) return false;
    const days = value.days;
    return typeof value.weekStartDate === 'string'
        && typeof value.carryToNextWeek === 'boolean'
        && ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].every((day) => isDayPlan(days[day]));
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

function isPersistedCheckinSnapshot(value: unknown): value is PersistedCheckinSnapshot {
    if (!isObject(value)) return false;
    return value.schemaVersion === 1
        && isWeeklyPlan(value.weeklyPlan)
        && isDailyRecords(value.dailyRecords);
}

export async function loadPersistedCheckin(): Promise<PersistedCheckinSnapshot | null> {
    const storage = getStorage();
    if (!storage) return null;

    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isPersistedCheckinSnapshot(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export async function savePersistedCheckin(snapshot: PersistedCheckinSnapshot): Promise<void> {
    const storage = getStorage();
    if (!storage) return;

    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}
