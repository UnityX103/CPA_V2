import { load } from '@tauri-apps/plugin-store';

export type RestDeskReminderMode = 'cockroachInvasion';

export interface PresencePreferences {
    inputActivityEnabled: boolean;
    restDeskReminderEnabled: boolean;
    restDeskReminderMode: RestDeskReminderMode;
}

export const DEFAULT_PRESENCE_PREFERENCES: PresencePreferences = {
    inputActivityEnabled: false,
    restDeskReminderEnabled: false,
    restDeskReminderMode: 'cockroachInvasion',
};

const STORE_PATH = 'presence-preferences.json';
const STORE_KEY = 'presencePreferences';
const SCHEMA_VERSION = 7;

// Legacy camera settings are deliberately discarded, without changing input opt-in.
export function normalizePresencePreferences(value: unknown): PresencePreferences {
    const persisted = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const inputActivityEnabled = persisted.inputActivityEnabled === true;
    return {
        inputActivityEnabled,
        restDeskReminderEnabled: inputActivityEnabled && persisted.restDeskReminderEnabled === true,
        restDeskReminderMode: 'cockroachInvasion',
    };
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadPresencePreferences(): Promise<PresencePreferences> {
    try {
        const store = await openStore();
        const value = await store.get<unknown>(STORE_KEY);
        const schemaVersion = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
        if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)
            || schemaVersion < 1 || schemaVersion > SCHEMA_VERSION) {
            return normalizePresencePreferences(null);
        }
        const normalized = normalizePresencePreferences(value);
        if (schemaVersion < SCHEMA_VERSION) {
            await store.set(STORE_KEY, { schemaVersion: SCHEMA_VERSION, ...normalized });
            await store.save();
        }
        return normalized;
    } catch (error) {
        console.warn('[presencePersistence] load failed', error);
        return normalizePresencePreferences(null);
    }
}

export async function savePresencePreferences(preferences: PresencePreferences): Promise<void> {
    try {
        const store = await openStore();
        await store.set(STORE_KEY, { schemaVersion: SCHEMA_VERSION, ...normalizePresencePreferences(preferences) });
        await store.save();
    } catch (error) {
        console.warn('[presencePersistence] save failed', error);
    }
}
