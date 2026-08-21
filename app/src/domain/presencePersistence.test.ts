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

const persistence = await import('./presencePersistence');

beforeEach(() => {
    storeData.clear();
    save.mockClear();
});

describe('presence persistence', () => {
    it('defaults to disabled when no value exists', async () => {
        await expect(persistence.loadPresencePreferences()).resolves.toEqual({
            enabled: false,
            intervalSeconds: 10,
            presentThresholdSeconds: 60,
        });
    });

    it('loads valid fields and independently defaults malformed or missing fields', async () => {
        storeData.set('presencePreferences', {
            schemaVersion: 1,
            enabled: true,
            intervalSeconds: 45,
            presentThresholdSeconds: 999,
        });

        await expect(persistence.loadPresencePreferences()).resolves.toEqual({
            enabled: true,
            intervalSeconds: 45,
            presentThresholdSeconds: 60,
        });
    });

    it('accepts a five-second camera detection interval', async () => {
        storeData.set('presencePreferences', {
            schemaVersion: 1,
            enabled: true,
            intervalSeconds: 5,
            presentThresholdSeconds: 5,
        });

        await expect(persistence.loadPresencePreferences()).resolves.toEqual({
            enabled: true,
            intervalSeconds: 5,
            presentThresholdSeconds: 5,
        });
    });

    it('falls back for unsupported schemas', async () => {
        storeData.set('presencePreferences', {
            schemaVersion: 2,
            enabled: true,
            intervalSeconds: 30,
            presentThresholdSeconds: 30,
        });
        await expect(persistence.loadPresencePreferences()).resolves.toEqual({
            enabled: false,
            intervalSeconds: 10,
            presentThresholdSeconds: 60,
        });
    });

    it('saves only device-local v1 settings', async () => {
        await persistence.savePresencePreferences({
            enabled: true,
            intervalSeconds: 30,
            presentThresholdSeconds: 120,
        });

        expect(storeData.get('presencePreferences')).toEqual({
            schemaVersion: 1,
            enabled: true,
            intervalSeconds: 30,
            presentThresholdSeconds: 120,
        });
        expect(save).toHaveBeenCalledTimes(1);
    });
});
