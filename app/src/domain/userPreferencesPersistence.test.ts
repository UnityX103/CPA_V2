import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultUserPreferencesSnapshot, normalizeUserPreferencesSnapshot } from './userPreferences';
import { loadPersistedUserPreferences, savePersistedUserPreferences } from './userPreferencesPersistence';

const store = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(async () => store),
}));

beforeEach(() => {
    store.get.mockReset();
    store.set.mockReset();
    store.save.mockReset();
});

describe('user preferences persistence', () => {
    it('normalizes retained fields', () => {
        const input = {
            ...defaultUserPreferencesSnapshot(),
            settings: { uiScale: 1.25, autostartEnabled: true },
        };

        const normalized = normalizeUserPreferencesSnapshot(input);

        expect(normalized?.settings).toEqual({ uiScale: 1.25, autostartEnabled: true });
        expect(normalized?.pomodoro.endActionMode).toBe('topWindow');
    });

    it('loads normalized preferences', async () => {
        store.get.mockResolvedValue(defaultUserPreferencesSnapshot());

        await expect(loadPersistedUserPreferences()).resolves.toEqual(defaultUserPreferencesSnapshot());
    });

    it('saves the retained schema', async () => {
        const snapshot = defaultUserPreferencesSnapshot();

        await savePersistedUserPreferences(snapshot);

        expect(store.set).toHaveBeenCalledWith('userPreferences', snapshot);
        expect(store.save).toHaveBeenCalledTimes(1);
    });
});
