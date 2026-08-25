import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = {
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
};

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(() => Promise.resolve(store)),
}));

describe('settingsPersistence', () => {
    const obsoleteActiveTitleKey = 'showActiveApp' + 'WindowTitle';
    const obsoleteAutoPinKey = 'autoPinOn' + 'FocusEnd';

    beforeEach(() => {
        store.get.mockReset();
        store.set.mockReset();
        store.save.mockReset();
    });

    it('loads persisted v1 settings and ignores obsolete fields', async () => {
        store.get.mockResolvedValue({
            v: 1,
            uiScale: 1.75,
            [obsoleteActiveTitleKey]: false,
            autostartEnabled: true,
            audioOutputDeviceId: 'coreaudio:external-dac',
            soundVolume: 0.45,
            [obsoleteAutoPinKey]: false,
        });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toEqual({
            uiScale: 1.75,
            autostartEnabled: true,
            audioOutputDeviceId: 'coreaudio:external-dac',
            soundVolume: 0.45,
        });
    });

    it('defaults missing autostartEnabled for older v1 settings', async () => {
        store.get.mockResolvedValue({ v: 1, uiScale: 1.75 });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toEqual({
            uiScale: 1.75,
            autostartEnabled: false,
            audioOutputDeviceId: null,
            soundVolume: 1,
        });
    });

    it('ignores malformed persisted settings', async () => {
        store.get.mockResolvedValue({ v: 1, uiScale: 'large' });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toBeNull();
    });

    it('ignores malformed autostart settings', async () => {
        store.get.mockResolvedValue({
            v: 1,
            uiScale: 1.75,
            [obsoleteActiveTitleKey]: true,
            autostartEnabled: 'yes',
        });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toBeNull();
    });

    it('saves persisted v1 settings without obsolete fields', async () => {
        const { savePersistedSettings } = await import('./settingsPersistence');

        await savePersistedSettings({
            uiScale: 2,
            autostartEnabled: true,
            audioOutputDeviceId: 'wasapi:speakers',
            soundVolume: 0.8,
        });

        expect(store.set).toHaveBeenCalledWith('settings', {
            v: 1,
            uiScale: 2,
            autostartEnabled: true,
            audioOutputDeviceId: 'wasapi:speakers',
            soundVolume: 0.8,
        });
        expect(store.save).toHaveBeenCalledTimes(1);
    });
});
