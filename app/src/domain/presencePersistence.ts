import { load } from '@tauri-apps/plugin-store';
import {
    DEFAULT_PRESENCE_ABSENCE_SENSITIVITY,
    isPresenceAbsenceSensitivity,
    type PresenceAbsenceSensitivity,
} from './presencePolicy';

export type { PresenceAbsenceSensitivity } from './presencePolicy';

export interface PresencePreferences {
    enabled: boolean;
    intervalSeconds: number;
    absenceSensitivity: PresenceAbsenceSensitivity;
}

export const DEFAULT_PRESENCE_PREFERENCES: PresencePreferences = {
    enabled: false,
    intervalSeconds: 10,
    absenceSensitivity: DEFAULT_PRESENCE_ABSENCE_SENSITIVITY,
};

export const MIN_PRESENCE_SECONDS = 5;
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

function normalizeAbsenceSensitivity(value: unknown): PresenceAbsenceSensitivity {
    return isPresenceAbsenceSensitivity(value)
        ? value
        : DEFAULT_PRESENCE_PREFERENCES.absenceSensitivity;
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
        absenceSensitivity: normalizeAbsenceSensitivity(persisted.absenceSensitivity),
    };
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadPresencePreferences(): Promise<PresencePreferences> {
    try {
        const store = await openStore();
        const value = await store.get<unknown>(STORE_KEY);
        if (!value || typeof value !== 'object') {
            return { ...DEFAULT_PRESENCE_PREFERENCES };
        }
        const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
        if (schemaVersion !== 1 && schemaVersion !== 2) {
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
            schemaVersion: 2,
            ...normalizePresencePreferences(preferences),
        });
        await store.save();
    } catch (error) {
        console.warn('[presencePersistence] save failed', error);
    }
}
