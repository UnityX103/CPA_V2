import type { StoreApi, UseBoundStore } from 'zustand';
import type { CheckinState, DailyCheckinRecord, WeeklyCheckinPlan } from './checkin';
import type { PomodoroActions, PomodoroState } from './pomodoro';
import type { PersistedSettingsSnapshot, SettingsState } from './settings';
import type { AppUpdateSnapshot } from './appUpdate';
import type { NetworkStateShape } from './network';
import type { BindingKeyEntry } from './bindingKey';
import {
    buildUserPreferencesSnapshot,
    hydrateUserPreferencesSnapshot,
    type PersistedBindingKeyEntry,
    type UserPreferencesSnapshot,
} from './userPreferences';

export interface CloudAccountData extends UserPreferencesSnapshot {
    updatedAt?: number;
}

type PomodoroStore = UseBoundStore<StoreApi<PomodoroState & PomodoroActions>>;
type SettingsStore = UseBoundStore<StoreApi<SettingsState & {
    hydrateSettings: (snapshot: PersistedSettingsSnapshot) => void;
}>>;
type AppUpdateStore = UseBoundStore<StoreApi<AppUpdateSnapshot>>;
type NetworkStore = UseBoundStore<StoreApi<NetworkStateShape>>;
type BindingKeyStore = UseBoundStore<StoreApi<{
    panelEnabled: boolean;
    entries: BindingKeyEntry[];
    syncedKeyId: string | null;
    capturingId: string | null;
}>>;
type CheckinStore = UseBoundStore<StoreApi<CheckinState & {
    hydrateCheckin: (snapshot: Pick<CheckinState, 'weeklyPlan' | 'dailyRecords'>) => void;
}>>;

export interface CloudStores {
    pomodoro: PomodoroStore;
    settings: SettingsStore;
    appUpdate: AppUpdateStore;
    network: NetworkStore;
    bindingKey: BindingKeyStore;
    checkin: CheckinStore;
}

export function buildCloudAccountData(stores: CloudStores): CloudAccountData {
    return buildUserPreferencesSnapshot(stores);
}

export function hydrateCloudAccountData({ stores, data }: {
    stores: CloudStores;
    data: CloudAccountData;
}): void {
    hydrateUserPreferencesSnapshot({ stores, snapshot: data });
}

export function mergeCloudAccountDataConflict({ server, local }: {
    server: CloudAccountData;
    local: CloudAccountData;
}): CloudAccountData {
    return {
        ...server,
        pomodoro: { ...server.pomodoro, endActionVideo: { ...server.pomodoro.endActionVideo } },
        settings: { ...server.settings },
        appUpdate: { ...server.appUpdate },
        network: { ...server.network },
        bindingKey: cloneBindingKey(server.bindingKey),
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

function cloneBindingKey(bindingKey: CloudAccountData['bindingKey']): CloudAccountData['bindingKey'] {
    return {
        panelEnabled: bindingKey.panelEnabled,
        syncedKeyId: bindingKey.syncedKeyId,
        entries: bindingKey.entries.map(cloneBindingKeyEntry),
    };
}

function cloneBindingKeyEntry(entry: PersistedBindingKeyEntry): PersistedBindingKeyEntry {
    return {
        ...entry,
        input: entry.input ? { ...entry.input } : null,
    };
}

function cloneDailyRecord(record: DailyCheckinRecord): DailyCheckinRecord {
    return {
        date: record.date,
        countsByItemId: { ...record.countsByItemId },
        processedPomodoroEndEventIds: [...record.processedPomodoroEndEventIds],
    };
}
