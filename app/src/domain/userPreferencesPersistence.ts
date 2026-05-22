import { load } from '@tauri-apps/plugin-store';
import {
    normalizeUserPreferencesSnapshot,
    type UserPreferencesSnapshot,
} from './userPreferences';

const STORE_PATH = 'user-preferences.json';
const STORE_KEY = 'userPreferences';

interface PersistedUserPreferencesV1 extends UserPreferencesSnapshot {
    schemaVersion: 1;
}

async function openStore() {
    return load(STORE_PATH, { defaults: {}, autoSave: false });
}

export async function loadPersistedUserPreferences(): Promise<UserPreferencesSnapshot | null> {
    try {
        const store = await openStore();
        const value = await store.get<unknown>(STORE_KEY);
        return normalizeUserPreferencesSnapshot(value);
    } catch (err) {
        console.warn('[userPreferencesPersistence] load failed', err);
        return null;
    }
}

export async function savePersistedUserPreferences(snapshot: UserPreferencesSnapshot): Promise<void> {
    try {
        const store = await openStore();
        await store.set(STORE_KEY, {
            ...snapshot,
            schemaVersion: 1,
        } satisfies PersistedUserPreferencesV1);
        await store.save();
    } catch (err) {
        console.warn('[userPreferencesPersistence] save failed', err);
    }
}
