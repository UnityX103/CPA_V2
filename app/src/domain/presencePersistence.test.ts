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

describe('input-only presence persistence', () => {
    it('defaults to input detection disabled and rejects unknown schemas', async () => {
        expect(await persistence.loadPresencePreferences()).toEqual(persistence.DEFAULT_PRESENCE_PREFERENCES);
        for (const schemaVersion of [0, 8, '7', null]) {
            storeData.set('presencePreferences', { schemaVersion, inputActivityEnabled: true });
            expect(await persistence.loadPresencePreferences()).toEqual(persistence.DEFAULT_PRESENCE_PREFERENCES);
        }
        expect(save).not.toHaveBeenCalled();
    });
    it.each([1, 2, 3, 4, 5, 6])('migrates camera settings from v%s and preserves input opt-in', async (schemaVersion) => {
        storeData.set('presencePreferences', { schemaVersion, enabled: true, inputActivityEnabled: true,
            cameraDeviceId: 'camera-usb', intervalSeconds: 600, absenceSensitivity: 'relaxed',
            workstationRegion: { x: 0, y: 0, width: 1, height: 1 }, restDeskReminderEnabled: true });
        const expected = { inputActivityEnabled: true, restDeskReminderEnabled: true,
            restDeskReminderMode: 'cockroachInvasion' };
        expect(await persistence.loadPresencePreferences()).toEqual(expected);
        expect(storeData.get('presencePreferences')).toEqual({ schemaVersion: 7, ...expected });
        expect(save).toHaveBeenCalledOnce();
    });
    it('does not grant input opt-in to camera-only users or retain reminders without it', async () => {
        storeData.set('presencePreferences', { schemaVersion: 6, enabled: true, restDeskReminderEnabled: true });
        expect(await persistence.loadPresencePreferences()).toEqual(persistence.DEFAULT_PRESENCE_PREFERENCES);
    });
    it('round-trips input-only settings without reintroducing camera fields', async () => {
        const preferences = { inputActivityEnabled: true, restDeskReminderEnabled: true,
            restDeskReminderMode: 'cockroachInvasion' as const };
        await persistence.savePresencePreferences(preferences);
        expect(storeData.get('presencePreferences')).toEqual({ schemaVersion: 7, ...preferences });
        expect(await persistence.loadPresencePreferences()).toEqual(preferences);
        expect(save).toHaveBeenCalledOnce();
    });
});
