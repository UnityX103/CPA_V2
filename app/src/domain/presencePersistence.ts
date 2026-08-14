import { load } from '@tauri-apps/plugin-store';

export interface PresencePreferences {
    enabled: boolean;
    intervalSeconds: number;
    presentThresholdSeconds: number;
}

export const DEFAULT_PRESENCE_PREFERENCES: PresencePreferences = {
    enabled: false,
    intervalSeconds: 60,
    presentThresholdSeconds: 60,
};

export const MIN_PRESENCE_SECONDS = 30;
export const MAX_PRESENCE_SECONDS = 600;

const STORE_PATH = 'presence-preferences.json';
const STORE_KEY = 'presencePreferences';

function normalizeSeconds(value: unknown, fallback: number): number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value >= MIN_PRESENCE_SECONDS
        && value <= MAX_PRESENCE_SECONDS
        ? value
        : fallback;
}

export function normalizePresencePreferences(value: unknown): PresencePreferences {
    if (!value || typeof value !== 'object') {
        return { ...DEFAULT_PRESENCE_PREFERENCES };
    }
    const persisted = value as Record<string, unknown>;
    return {
        enabled: typeof persisted.enabled === 'boolean'
            ? persisted.enabled
            : DEFAULT_PRESENCE_PREFERENCES.enabled,
        intervalSeconds: normalizeSeconds(
            persisted.intervalSeconds,
            DEFAULT_PRESENCE_PREFERENCES.intervalSeconds,
        ),
        presentThresholdSeconds: normalizeSeconds(
            persisted.presentThresholdSeconds,
            DEFAULT_PRESENCE_PREFERENCES.presentThresholdSeconds,
        ),
    };
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadPresencePreferences(): Promise<PresencePreferences> {
    try {
        const store = await openStore();
        const value = await store.get<unknown>(STORE_KEY);
        if (!value || typeof value !== 'object' || (value as { schemaVersion?: unknown }).schemaVersion !== 1) {
            return { ...DEFAULT_PRESENCE_PREFERENCES };
        }
        return normalizePresencePreferences(value);
    } catch (error) {
        console.warn('[presencePersistence] load failed', error);
        return { ...DEFAULT_PRESENCE_PREFERENCES };
    }
}

export async function savePresencePreferences(preferences: PresencePreferences): Promise<void> {
    try {
        const store = await openStore();
        await store.set(STORE_KEY, {
            schemaVersion: 1,
            ...normalizePresencePreferences(preferences),
        });
        await store.save();
    } catch (error) {
        console.warn('[presencePersistence] save failed', error);
    }
}
