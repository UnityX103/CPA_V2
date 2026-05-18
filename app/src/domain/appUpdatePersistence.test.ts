import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeData = new Map<string, unknown>();
const save = vi.fn(async () => {});

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(async () => ({
        get: async (key: string) => storeData.get(key),
        set: async (key: string, value: unknown) => { storeData.set(key, value); },
        save,
    })),
}));

const persistence = await import('./appUpdatePersistence');

beforeEach(() => {
    storeData.clear();
    save.mockClear();
});

describe('app update persistence', () => {
    it('returns default enabled when no persisted value exists', async () => {
        await expect(persistence.loadPersistedAppUpdateSettings()).resolves.toEqual({
            autoUpdateEnabled: true,
        });
    });

    it('loads persisted disabled value', async () => {
        storeData.set('appUpdate', { v: 1, autoUpdateEnabled: false });
        await expect(persistence.loadPersistedAppUpdateSettings()).resolves.toEqual({
            autoUpdateEnabled: false,
        });
    });

    it('ignores malformed persisted values', async () => {
        storeData.set('appUpdate', { v: 1, autoUpdateEnabled: 'nope' });
        await expect(persistence.loadPersistedAppUpdateSettings()).resolves.toEqual({
            autoUpdateEnabled: true,
        });
    });

    it('saves v1 app update settings', async () => {
        await persistence.savePersistedAppUpdateSettings({ autoUpdateEnabled: false });
        expect(storeData.get('appUpdate')).toEqual({ v: 1, autoUpdateEnabled: false });
        expect(save).toHaveBeenCalledTimes(1);
    });
});
