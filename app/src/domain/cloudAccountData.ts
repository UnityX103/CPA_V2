import type { StoreApi, UseBoundStore } from 'zustand';
import type { PomodoroActions, PomodoroState } from './pomodoro';
import type { PersistedSettingsSnapshot, SettingsState } from './settings';
import type { AppUpdateSnapshot } from './appUpdate';
import type { NetworkStateShape } from './network';
import type { BindingKeyEntry } from './bindingKey';
import {
    buildUserPreferencesSnapshot,
    hydrateUserPreferencesSnapshot,
    normalizeUserPreferencesSnapshot,
    type PersistedBindingKeyEntry,
    type UserPreferencesSnapshot,
} from './userPreferences';
import { clonePomodoroEndSounds } from './pomodoroSounds';

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
export interface CloudStores {
    pomodoro: PomodoroStore;
    settings: SettingsStore;
    appUpdate: AppUpdateStore;
    network: NetworkStore;
    bindingKey: BindingKeyStore;
}

export function buildCloudAccountData(stores: CloudStores): CloudAccountData {
    return buildUserPreferencesSnapshot(stores);
}

export function hydrateCloudAccountData({ stores, data }: {
    stores: CloudStores;
    data: CloudAccountData;
}): void {
    const normalized = normalizeUserPreferencesSnapshot(data);
    if (!normalized) return;
    hydrateUserPreferencesSnapshot({ stores, snapshot: normalized });
}

export function mergeCloudAccountDataConflict({ server }: {
    server: CloudAccountData;
    local: CloudAccountData;
}): CloudAccountData {
    const normalizedServer = normalizeUserPreferencesSnapshot(server) ?? server;
    return {
        ...normalizedServer,
        updatedAt: server.updatedAt,
        pomodoro: {
            ...normalizedServer.pomodoro,
            endActionVideo: { ...normalizedServer.pomodoro.endActionVideo },
            endSounds: clonePomodoroEndSounds(normalizedServer.pomodoro.endSounds),
        },
        settings: { ...normalizedServer.settings },
        appUpdate: { ...normalizedServer.appUpdate },
        network: { ...normalizedServer.network },
        bindingKey: cloneBindingKey(normalizedServer.bindingKey),
    };
}

export function cloudAccountDataKey(data: CloudAccountData): string {
    const { updatedAt: _updatedAt, ...payload } = data;
    return JSON.stringify(payload);
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
