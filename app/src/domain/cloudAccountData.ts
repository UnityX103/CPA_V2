import type { StoreApi, UseBoundStore } from 'zustand';
import type { CheckinState, DailyCheckinRecord, WeeklyCheckinPlan } from './checkin';
import type {
    PomodoroActions,
    PomodoroEndActionMode,
    PomodoroEndActionVideo,
    PomodoroState,
} from './pomodoro';
import type { PersistedSettingsSnapshot, SettingsState } from './settings';

export interface CloudAccountData {
    schemaVersion: 1;
    updatedAt?: number;
    pomodoro: {
        focusDurationSeconds: number;
        breakDurationSeconds: number;
        totalRounds: number;
        autoStartBreak: boolean;
        endActionMode: PomodoroEndActionMode;
        endActionVideo: PomodoroEndActionVideo;
    };
    settings: {
        uiScale: number;
        autostartEnabled: boolean;
    };
    checkin: {
        weeklyPlan: WeeklyCheckinPlan;
        dailyRecords: Record<string, DailyCheckinRecord>;
    };
}

type PomodoroStore = UseBoundStore<StoreApi<PomodoroState & PomodoroActions>>;
type SettingsStore = UseBoundStore<StoreApi<SettingsState & {
    hydrateSettings: (snapshot: PersistedSettingsSnapshot) => void;
}>>;
type CheckinStore = UseBoundStore<StoreApi<CheckinState & {
    hydrateCheckin: (snapshot: Pick<CheckinState, 'weeklyPlan' | 'dailyRecords'>) => void;
}>>;

export interface CloudStores {
    pomodoro: PomodoroStore;
    settings: SettingsStore;
    checkin: CheckinStore;
}

export function buildCloudAccountData(stores: CloudStores): CloudAccountData {
    const p = stores.pomodoro.getState();
    const s = stores.settings.getState();
    const c = stores.checkin.getState();
    return {
        schemaVersion: 1,
        pomodoro: {
            focusDurationSeconds: p.focusDurationSeconds,
            breakDurationSeconds: p.breakDurationSeconds,
            totalRounds: p.totalRounds,
            autoStartBreak: p.autoStartBreak,
            endActionMode: p.endActionMode,
            endActionVideo: { ...p.endActionVideo },
        },
        settings: {
            uiScale: s.committedUiScale,
            autostartEnabled: s.autostartEnabled,
        },
        checkin: {
            weeklyPlan: cloneWeeklyPlan(c.weeklyPlan),
            dailyRecords: cloneDailyRecords(c.dailyRecords),
        },
    };
}

export function hydrateCloudAccountData({ stores, data }: {
    stores: CloudStores;
    data: CloudAccountData;
}): void {
    stores.pomodoro.getState().applySettings(
        data.pomodoro.focusDurationSeconds,
        data.pomodoro.breakDurationSeconds,
        data.pomodoro.totalRounds,
        false,
        data.pomodoro.autoStartBreak,
    );
    stores.pomodoro.getState().applyEndActionSettings(
        data.pomodoro.endActionMode,
        data.pomodoro.endActionVideo,
    );
    stores.settings.getState().hydrateSettings(data.settings);
    stores.checkin.getState().hydrateCheckin({
        weeklyPlan: cloneWeeklyPlan(data.checkin.weeklyPlan),
        dailyRecords: cloneDailyRecords(data.checkin.dailyRecords),
    });
}

export function mergeCloudAccountDataConflict({ server, local }: {
    server: CloudAccountData;
    local: CloudAccountData;
}): CloudAccountData {
    return {
        ...server,
        checkin: {
            weeklyPlan: cloneWeeklyPlan(server.checkin.weeklyPlan),
            dailyRecords: mergeDailyRecords(server.checkin.dailyRecords, local.checkin.dailyRecords),
        },
    };
}

export function cloudAccountDataKey(data: CloudAccountData): string {
    const { updatedAt: _updatedAt, ...payload } = data;
    return JSON.stringify(payload);
}

function mergeDailyRecords(
    server: Record<string, DailyCheckinRecord>,
    local: Record<string, DailyCheckinRecord>,
): Record<string, DailyCheckinRecord> {
    const dates = new Set([...Object.keys(server), ...Object.keys(local)]);
    const result: Record<string, DailyCheckinRecord> = {};
    for (const date of dates) {
        const a = server[date];
        const b = local[date];
        if (!a) {
            result[date] = cloneDailyRecord(b);
            continue;
        }
        if (!b) {
            result[date] = cloneDailyRecord(a);
            continue;
        }
        const ids = new Set([...Object.keys(a.countsByItemId), ...Object.keys(b.countsByItemId)]);
        const countsByItemId: Record<string, number> = {};
        for (const id of ids) {
            countsByItemId[id] = Math.max(a.countsByItemId[id] ?? 0, b.countsByItemId[id] ?? 0);
        }
        result[date] = {
            date,
            countsByItemId,
            processedPomodoroEndEventIds: [
                ...a.processedPomodoroEndEventIds,
                ...b.processedPomodoroEndEventIds.filter((id) => !a.processedPomodoroEndEventIds.includes(id)),
            ],
        };
    }
    return result;
}

function cloneWeeklyPlan(plan: WeeklyCheckinPlan): WeeklyCheckinPlan {
    return JSON.parse(JSON.stringify(plan)) as WeeklyCheckinPlan;
}

function cloneDailyRecord(record: DailyCheckinRecord): DailyCheckinRecord {
    return {
        date: record.date,
        countsByItemId: { ...record.countsByItemId },
        processedPomodoroEndEventIds: [...record.processedPomodoroEndEventIds],
    };
}

function cloneDailyRecords(records: Record<string, DailyCheckinRecord>): Record<string, DailyCheckinRecord> {
    return Object.fromEntries(
        Object.entries(records).map(([date, record]) => [date, cloneDailyRecord(record)]),
    );
}
