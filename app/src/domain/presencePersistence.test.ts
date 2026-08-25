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
            absenceSensitivity: 'strict',
        });
    });

    it('loads valid fields and ignores the removed confirmation threshold', async () => {
        storeData.set('presencePreferences', {
            schemaVersion: 1,
            enabled: true,
            intervalSeconds: 45,
            presentThresholdSeconds: 999,
        });

        await expect(persistence.loadPresencePreferences()).resolves.toEqual({
            enabled: true,
            intervalSeconds: 45,
            absenceSensitivity: 'strict',
        });
    });

    it('loads the disabled state and all three sensitivity levels from device-local v2 settings', async () => {
        for (const absenceSensitivity of ['off', 'strict', 'balanced', 'relaxed']) {
            storeData.set('presencePreferences', {
                schemaVersion: 2,
                enabled: true,
                intervalSeconds: 10,
                absenceSensitivity,
            });

            await expect(persistence.loadPresencePreferences()).resolves.toEqual({
                enabled: true,
                intervalSeconds: 10,
                absenceSensitivity,
            });
        }
    });

    it('accepts a five-second camera detection interval', async () => {
        storeData.set('presencePreferences', {
            schemaVersion: 1,
            enabled: true,
            intervalSeconds: 5,
        });

        await expect(persistence.loadPresencePreferences()).resolves.toEqual({
            enabled: true,
            intervalSeconds: 5,
            absenceSensitivity: 'strict',
        });
    });

    it('falls back for unsupported schemas', async () => {
        storeData.set('presencePreferences', {
            schemaVersion: 3,
            enabled: true,
            intervalSeconds: 30,
        });
        await expect(persistence.loadPresencePreferences()).resolves.toEqual({
            enabled: false,
            intervalSeconds: 10,
            absenceSensitivity: 'strict',
        });
    });

    it('saves only device-local v2 settings', async () => {
        await persistence.savePresencePreferences({
            enabled: true,
            intervalSeconds: 30,
            absenceSensitivity: 'relaxed',
        });

        expect(storeData.get('presencePreferences')).toEqual({
            schemaVersion: 2,
            enabled: true,
            intervalSeconds: 30,
            absenceSensitivity: 'relaxed',
        });
        expect(save).toHaveBeenCalledTimes(1);
    });
});
