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
    beforeEach(() => {
        store.get.mockReset();
        store.set.mockReset();
        store.save.mockReset();
    });

    it('loads persisted v1 settings', async () => {
        store.get.mockResolvedValue({
            v: 1,
            uiScale: 1.75,
            showActiveAppWindowTitle: false,
            autostartEnabled: true,
        });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toEqual({
            uiScale: 1.75,
            showActiveAppWindowTitle: false,
            autostartEnabled: true,
            autoPinOnFocusEnd: true,
        });
    });

    it('loads persisted autoPinOnFocusEnd settings', async () => {
        store.get.mockResolvedValue({
            v: 1,
            uiScale: 1.75,
            showActiveAppWindowTitle: false,
            autostartEnabled: true,
            autoPinOnFocusEnd: false,
        });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toEqual({
            uiScale: 1.75,
            showActiveAppWindowTitle: false,
            autostartEnabled: true,
            autoPinOnFocusEnd: false,
        });
    });

    it('defaults showActiveAppWindowTitle to true for older v1 settings', async () => {
        store.get.mockResolvedValue({ v: 1, uiScale: 1.75 });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toEqual({
            uiScale: 1.75,
            showActiveAppWindowTitle: true,
            autostartEnabled: false,
            autoPinOnFocusEnd: true,
        });
    });

    it('defaults autoPinOnFocusEnd to true for older v1 settings', async () => {
        store.get.mockResolvedValue({ v: 1, uiScale: 1.75 });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toEqual({
            uiScale: 1.75,
            showActiveAppWindowTitle: true,
            autostartEnabled: false,
            autoPinOnFocusEnd: true,
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
            showActiveAppWindowTitle: true,
            autostartEnabled: 'yes',
        });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toBeNull();
    });

    it('ignores malformed autoPinOnFocusEnd settings', async () => {
        store.get.mockResolvedValue({
            v: 1,
            uiScale: 1.75,
            showActiveAppWindowTitle: true,
            autostartEnabled: false,
            autoPinOnFocusEnd: 'yes',
        });
        const { loadPersistedSettings } = await import('./settingsPersistence');

        await expect(loadPersistedSettings()).resolves.toBeNull();
    });

    it('saves persisted v1 settings', async () => {
        const { savePersistedSettings } = await import('./settingsPersistence');

        await savePersistedSettings({
            uiScale: 2,
            showActiveAppWindowTitle: false,
            autostartEnabled: true,
            autoPinOnFocusEnd: false,
        });

        expect(store.set).toHaveBeenCalledWith('settings', {
            v: 1,
            uiScale: 2,
            showActiveAppWindowTitle: false,
            autostartEnabled: true,
            autoPinOnFocusEnd: false,
        });
        expect(store.save).toHaveBeenCalledTimes(1);
    });
});
