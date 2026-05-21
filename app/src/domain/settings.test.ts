import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, MIN_SCALE, MAX_SCALE } from './settings';
import { createSettingsStore } from './settings';
import * as dispatchMod from './bridge/dispatch';
import { BRIDGE_VERSION } from './bridge/protocol';
import { vi } from 'vitest';

beforeEach(() => {
    useSettingsStore.setState({
        activeTab: 'pomodoro',
        uiScale: 1.0,
    });
});

describe('useSettingsStore', () => {
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

    it('does not expose target monitor state now that windows can be dragged directly', () => {
        expect('targetMonitorIndex' in useSettingsStore.getState()).toBe(false);
        expect('setTargetMonitor' in useSettingsStore.getState()).toBe(false);
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
});
