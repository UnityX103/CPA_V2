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
        expect(save).toHaveBeenCalledWith({
            uiScale: 1,
            autostartEnabled: true,
            audioOutputDeviceId: null,
            soundVolume: 1,
        });
    });

    it('persists output-device and clamped volume changes locally', () => {
        const save = vi.spyOn(persistence, 'savePersistedSettings').mockResolvedValue();
        const store = createSettingsStore({ isSettingsWindow: false });

        store.getState().setAudioOutputDeviceId('wasapi:speakers');
        store.getState().setSoundVolume(1.5);

        expect(store.getState()).toEqual(expect.objectContaining({
            audioOutputDeviceId: 'wasapi:speakers',
            soundVolume: 1,
        }));
        expect(save).toHaveBeenLastCalledWith({
            uiScale: 1,
            autostartEnabled: false,
            audioOutputDeviceId: 'wasapi:speakers',
            soundVolume: 1,
        });
    });

    it('preserves machine-local audio settings when cloud preferences hydrate', () => {
        const store = createSettingsStore({ isSettingsWindow: false });
        store.setState({
            audioOutputDeviceId: 'coreaudio:external-dac',
            soundVolume: 0.35,
        });

        store.getState().hydrateSettings({ uiScale: 1.25, autostartEnabled: true });

        expect(store.getState()).toEqual(expect.objectContaining({
            uiScale: 1.25,
            autostartEnabled: true,
            audioOutputDeviceId: 'coreaudio:external-dac',
            soundVolume: 0.35,
        }));
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

        store.getState().setSoundVolume(0.4);
        expect(dispatch).toHaveBeenLastCalledWith({
            v: BRIDGE_VERSION,
            store: 'settings',
            action: 'setSoundVolume',
            args: [0.4],
        });
    });
});
