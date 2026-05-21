import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

const settingsMocks = vi.hoisted(() => ({
    savePersistedSettings: vi.fn(),
    applyAutostartEnabled: vi.fn(),
}));

vi.mock('./settingsPersistence', () => ({
    savePersistedSettings: settingsMocks.savePersistedSettings,
}));

vi.mock('./autostart', () => ({
    applyAutostartEnabled: settingsMocks.applyAutostartEnabled,
}));

import {
    useSettingsStore,
    MIN_SCALE,
    MAX_SCALE,
    DANGEROUS_CHANGE_TIMEOUT_MS,
    type DangerousChange,
} from './settings';
import { createSettingsStore } from './settings';
import * as dispatchMod from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';

beforeEach(() => {
    settingsMocks.savePersistedSettings.mockReset();
    settingsMocks.applyAutostartEnabled.mockReset();
    settingsMocks.applyAutostartEnabled.mockImplementation((enabled) => Promise.resolve(enabled));
    useSettingsStore.setState({
        activeTab: 'pomodoro',
        uiScale: 1.0,
        committedUiScale: 1.0,
        autostartEnabled: false,
        dangerousChange: null,
    });
});

describe('useSettingsStore', () => {
    it('caps UI scale at 2.0', () => {
        expect(MAX_SCALE).toBe(2.0);
    });

    it('setActiveTab switches the active tab', () => {
        useSettingsStore.getState().setActiveTab('global');
        expect(useSettingsStore.getState().activeTab).toBe('global');
    });

    it('setUiScale clamps below MIN_SCALE', () => {
        useSettingsStore.getState().setUiScale(0.1);
        expect(useSettingsStore.getState().uiScale).toBe(MIN_SCALE);
    });

    it('setUiScale clamps above MAX_SCALE', () => {
        useSettingsStore.getState().setUiScale(99);
        expect(useSettingsStore.getState().uiScale).toBe(MAX_SCALE);
    });

    it('does not expose obsolete target monitor state or actions', () => {
        const state = useSettingsStore.getState();
        expect('targetMonitorIndex' in state).toBe(false);
        expect('setTargetMonitor' in state).toBe(false);
    });

    it('does not expose obsolete active-title or auto-pin settings', () => {
        const state = useSettingsStore.getState();

        expect('showActiveAppWindowTitle' in state).toBe(false);
        expect('setShowActiveAppWindowTitle' in state).toBe(false);
        expect('autoPinOnFocusEnd' in state).toBe(false);
        expect('setAutoPinOnFocusEnd' in state).toBe(false);
    });

    it('previewDangerousUiScale records previous and next values', () => {
        const before = Date.now();
        useSettingsStore.getState().previewDangerousUiScale(1.75);
        const state = useSettingsStore.getState();

        expect(state.uiScale).toBe(1.75);
        expect(state.committedUiScale).toBe(1.0);
        expect(state.dangerousChange).toEqual(expect.objectContaining({
            kind: 'uiScale',
            previousValue: 1.0,
            nextValue: 1.75,
        }));
        expect(state.dangerousChange!.expiresAt).toBeGreaterThanOrEqual(before + DANGEROUS_CHANGE_TIMEOUT_MS);
    });

    it('previewDangerousUiScale updates an existing preview without changing previousValue', () => {
        useSettingsStore.getState().previewDangerousUiScale(1.5);
        const first = useSettingsStore.getState().dangerousChange as DangerousChange;

        useSettingsStore.getState().previewDangerousUiScale(2.0);
        const second = useSettingsStore.getState().dangerousChange as DangerousChange;

        expect(second.id).toBe(first.id);
        expect(second.previousValue).toBe(1.0);
        expect(second.nextValue).toBe(2.0);
        expect(useSettingsStore.getState().uiScale).toBe(2.0);
    });

    it('revertDangerousChange restores previous committed scale', () => {
        useSettingsStore.getState().previewDangerousUiScale(1.8);
        const id = useSettingsStore.getState().dangerousChange!.id;

        useSettingsStore.getState().revertDangerousChange(id);

        expect(useSettingsStore.getState().uiScale).toBe(1.0);
        expect(useSettingsStore.getState().committedUiScale).toBe(1.0);
        expect(useSettingsStore.getState().dangerousChange).toBeNull();
    });

    it('applyDangerousChange commits the preview scale', () => {
        useSettingsStore.getState().previewDangerousUiScale(1.8);
        const id = useSettingsStore.getState().dangerousChange!.id;

        useSettingsStore.getState().applyDangerousChange(id);

        expect(useSettingsStore.getState().uiScale).toBe(1.8);
        expect(useSettingsStore.getState().committedUiScale).toBe(1.8);
        expect(useSettingsStore.getState().dangerousChange).toBeNull();
    });

    it('ignores stale apply and revert ids', () => {
        useSettingsStore.getState().previewDangerousUiScale(1.8);

        useSettingsStore.getState().applyDangerousChange('stale-id');
        expect(useSettingsStore.getState().dangerousChange).not.toBeNull();
        expect(useSettingsStore.getState().committedUiScale).toBe(1.0);

        useSettingsStore.getState().revertDangerousChange('stale-id');
        expect(useSettingsStore.getState().dangerousChange).not.toBeNull();
        expect(useSettingsStore.getState().uiScale).toBe(1.8);
    });

    it('hydrateSettings clamps persisted scale into committed and effective scale', () => {
        useSettingsStore.getState().hydrateSettings({ uiScale: 99 });
        expect(useSettingsStore.getState().uiScale).toBe(MAX_SCALE);
        expect(useSettingsStore.getState().committedUiScale).toBe(MAX_SCALE);
        expect(useSettingsStore.getState().dangerousChange).toBeNull();
    });

    it('defaults autostartEnabled to false', () => {
        expect(useSettingsStore.getState().autostartEnabled).toBe(false);

        const settingsWindowStore = createSettingsStore({ isSettingsWindow: true });
        expect(settingsWindowStore.getState().autostartEnabled).toBe(false);
    });

    it('hydrates autostartEnabled from persisted settings', () => {
        useSettingsStore.getState().hydrateSettings({ uiScale: 1.25, autostartEnabled: true });

        expect(useSettingsStore.getState().autostartEnabled).toBe(true);
    });

    it('defaults missing persisted autostartEnabled to false during hydration', () => {
        useSettingsStore.setState({ autostartEnabled: true });

        useSettingsStore.getState().hydrateSettings({ uiScale: 1.25 });

        expect(useSettingsStore.getState().autostartEnabled).toBe(false);
    });

    it('setAutostartEnabled applies native setting and persists confirmed value', async () => {
        settingsMocks.applyAutostartEnabled.mockResolvedValue(true);
        useSettingsStore.setState({
            committedUiScale: 1.5,
            autostartEnabled: false,
        });

        await useSettingsStore.getState().setAutostartEnabled(true);

        expect(settingsMocks.applyAutostartEnabled).toHaveBeenCalledWith(true, false);
        expect(useSettingsStore.getState().autostartEnabled).toBe(true);
        expect(settingsMocks.savePersistedSettings).toHaveBeenCalledWith({
            uiScale: 1.5,
            autostartEnabled: true,
        });
    });
});

describe('createSettingsStore — settings-window mode', () => {
    it('setUiScale dispatches instead of mutating local state', async () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createSettingsStore({ isSettingsWindow: true });
        const before = store.getState().uiScale;
        store.getState().setUiScale(1.75);
        expect(store.getState().uiScale).toBe(before); // not locally mutated
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION, store: 'settings', action: 'setUiScale', args: [1.75],
        }));
        spy.mockRestore();
    });

    it('dangerous actions dispatch instead of mutating local state', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createSettingsStore({ isSettingsWindow: true });

        store.getState().previewDangerousUiScale(1.75);
        store.getState().applyDangerousChange('pending-id');
        store.getState().revertDangerousChange('pending-id');

        expect(store.getState().uiScale).toBe(1.0);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION,
            store: 'settings',
            action: 'previewDangerousUiScale',
            args: [1.75],
        }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION,
            store: 'settings',
            action: 'applyDangerousChange',
            args: ['pending-id'],
        }));
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION,
            store: 'settings',
            action: 'revertDangerousChange',
            args: ['pending-id'],
        }));
        spy.mockRestore();
    });

    it('setActiveTab is local in settings-window mode (no dispatch)', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createSettingsStore({ isSettingsWindow: true });
        store.getState().setActiveTab('global');
        expect(store.getState().activeTab).toBe('global');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('does not expose target monitor dispatch from the settings window store', () => {
        const store = createSettingsStore({ isSettingsWindow: true });
        expect('targetMonitorIndex' in store.getState()).toBe(false);
        expect('setTargetMonitor' in store.getState()).toBe(false);
    });

    it('setAutostartEnabled dispatches instead of mutating local state', () => {
        const spy = vi.spyOn(dispatchMod, 'dispatch').mockResolvedValue();
        const store = createSettingsStore({ isSettingsWindow: true });

        void store.getState().setAutostartEnabled(true);

        expect(store.getState().autostartEnabled).toBe(false);
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({
            v: BRIDGE_VERSION,
            store: 'settings',
            action: 'setAutostartEnabled',
            args: [true],
        }));
        spy.mockRestore();
    });

});
