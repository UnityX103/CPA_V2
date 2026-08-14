import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore, MAX_SCALE, MIN_SCALE } from './settings';
import * as autostart from './autostart';
import * as persistence from './settingsPersistence';
import * as dispatchModule from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

describe('settings store', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps only retained tabs', () => {
        const store = createSettingsStore({ isSettingsWindow: false });

        store.getState().setActiveTab('global');

        expect(store.getState().activeTab).toBe('global');
    });

    it('clamps scale changes', () => {
        const store = createSettingsStore({ isSettingsWindow: false });

        store.getState().setUiScale(0.1);
        expect(store.getState().uiScale).toBe(MIN_SCALE);
        store.getState().setUiScale(3);
        expect(store.getState().uiScale).toBe(MAX_SCALE);
    });

    it('persists the confirmed native autostart value', async () => {
        vi.spyOn(autostart, 'applyAutostartEnabled').mockResolvedValue(true);
        const save = vi.spyOn(persistence, 'savePersistedSettings').mockResolvedValue();
        const store = createSettingsStore({ isSettingsWindow: false });

        await store.getState().setAutostartEnabled(true);

        expect(store.getState().autostartEnabled).toBe(true);
        expect(save).toHaveBeenCalledWith({ uiScale: 1, autostartEnabled: true });
    });

    it('dispatches settings-window changes to the main store', () => {
        const dispatch = vi.spyOn(dispatchModule, 'dispatch').mockResolvedValue();
        const store = createSettingsStore({ isSettingsWindow: true });

        store.getState().setUiScale(1.25);

        expect(dispatch).toHaveBeenCalledWith({
            v: BRIDGE_VERSION,
            store: 'settings',
            action: 'setUiScale',
            args: [1.25],
        });
    });
});
