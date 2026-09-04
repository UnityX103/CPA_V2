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
            cameraDeviceId: null,
            intervalSeconds: 10,
            absenceSensitivity: 'strict',
            restDeskReminderEnabled: false,
            restDeskReminderMode: 'cockroachInvasion',
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
            cameraDeviceId: null,
            intervalSeconds: 45,
            absenceSensitivity: 'strict',
            restDeskReminderEnabled: false,
            restDeskReminderMode: 'cockroachInvasion',
        });
    });

    it('loads all four sensitivity levels from device-local v2 settings', async () => {
        for (const absenceSensitivity of ['off', 'strict', 'balanced', 'relaxed']) {
            storeData.set('presencePreferences', {
                schemaVersion: 2,
                enabled: true,
                intervalSeconds: 10,
                absenceSensitivity,
                restDeskReminderEnabled: false,
                restDeskReminderMode: 'cockroachInvasion',
            });

            await expect(persistence.loadPresencePreferences()).resolves.toEqual({
                enabled: true,
                cameraDeviceId: null,
                intervalSeconds: 10,
                absenceSensitivity,
                restDeskReminderEnabled: false,
                restDeskReminderMode: 'cockroachInvasion',
            });
        }
    });

    it('loads the enabled cockroach reminder from device-local v3 settings', async () => {
        storeData.set('presencePreferences', {
            schemaVersion: 3,
            enabled: true,
            intervalSeconds: 10,
            absenceSensitivity: 'strict',
            restDeskReminderEnabled: true,
            restDeskReminderMode: 'cockroachInvasion',
        });

        await expect(persistence.loadPresencePreferences()).resolves.toEqual({
            enabled: true,
            cameraDeviceId: null,
            intervalSeconds: 10,
            absenceSensitivity: 'strict',
            restDeskReminderEnabled: true,
            restDeskReminderMode: 'cockroachInvasion',
        });
    });

    it('accepts a five-second camera detection interval', async () => {
        storeData.set('presencePreferences', {
            schemaVersion: 1,
            enabled: true,
            intervalSeconds: 5,
        });

        await expect(persistence.loadPresencePreferences()).resolves.toEqual({
            enabled: true,
            cameraDeviceId: null,
            intervalSeconds: 5,
            absenceSensitivity: 'strict',
            restDeskReminderEnabled: false,
            restDeskReminderMode: 'cockroachInvasion',
        });
    });

    it('falls back for unsupported schemas', async () => {
        storeData.set('presencePreferences', {
            schemaVersion: 5,
            enabled: true,
            intervalSeconds: 30,
        });
        await expect(persistence.loadPresencePreferences()).resolves.toEqual({
            enabled: false,
            cameraDeviceId: null,
            intervalSeconds: 10,
            absenceSensitivity: 'strict',
            restDeskReminderEnabled: false,
            restDeskReminderMode: 'cockroachInvasion',
        });
    });

    it('saves only device-local v4 settings', async () => {
        await persistence.savePresencePreferences({
            enabled: true,
            cameraDeviceId: 'camera-usb',
            intervalSeconds: 30,
            absenceSensitivity: 'relaxed',
            restDeskReminderEnabled: true,
            restDeskReminderMode: 'cockroachInvasion',
        });

        expect(storeData.get('presencePreferences')).toEqual({
            schemaVersion: 4,
            enabled: true,
            cameraDeviceId: 'camera-usb',
            intervalSeconds: 30,
            absenceSensitivity: 'relaxed',
            restDeskReminderEnabled: true,
            restDeskReminderMode: 'cockroachInvasion',
        });
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('loads a selected camera from device-local v4 settings', async () => {
        storeData.set('presencePreferences', {
            schemaVersion: 4,
            enabled: true,
            cameraDeviceId: 'camera-usb',
            intervalSeconds: 10,
            absenceSensitivity: 'balanced',
            restDeskReminderEnabled: false,
            restDeskReminderMode: 'cockroachInvasion',
        });

        await expect(persistence.loadPresencePreferences()).resolves.toEqual({
            enabled: true,
            cameraDeviceId: 'camera-usb',
            intervalSeconds: 10,
            absenceSensitivity: 'balanced',
            restDeskReminderEnabled: false,
            restDeskReminderMode: 'cockroachInvasion',
        });
    });
});
