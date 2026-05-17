import { describe, it, expect, beforeEach } from 'vitest';
import { applyDispatch, buildSnapshot } from './host';
import { useSettingsStore } from '../settings';
import { usePomodoroStore } from '../pomodoro';
import { useNetworkStore } from '../network';
import { useBindingKeyStore } from '../bindingKey';
import { BRIDGE_VERSION } from './protocol';

beforeEach(() => {
    useSettingsStore.setState({ uiScale: 1.0, activeTab: 'pomodoro' });
});

describe('buildSnapshot', () => {
    it('reads from every source store and stamps the version', () => {
        useSettingsStore.setState({ uiScale: 1.5 });
        usePomodoroStore.setState({ autoStartBreak: true });
        const snap = buildSnapshot();
        expect(snap.v).toBe(BRIDGE_VERSION);
        expect(snap.settings.uiScale).toBe(1.5);
        expect('targetMonitorIndex' in snap.settings).toBe(false);
        expect(snap.pomodoro.focusDurationSeconds).toBe(usePomodoroStore.getState().focusDurationSeconds);
        expect(snap.pomodoro.autoStartBreak).toBe(true);
        expect(snap.network.status).toBe(useNetworkStore.getState().status);
        expect(snap.bindingKey.entries).toBe(useBindingKeyStore.getState().entries);
    });

    it('does NOT include transient timer fields like remainingSeconds', () => {
        const snap = buildSnapshot();
        // @ts-expect-error remainingSeconds is intentionally absent from the snapshot type
        expect(snap.pomodoro.remainingSeconds).toBeUndefined();
    });
});

describe('applyDispatch', () => {
    it('routes settings/setUiScale to useSettingsStore.setUiScale', () => {
        applyDispatch({ v: BRIDGE_VERSION, store: 'settings', action: 'setUiScale', args: [1.75] });
        expect(useSettingsStore.getState().uiScale).toBe(1.75);
    });

    it('routes pomodoro/applySettings to usePomodoroStore.applySettings', () => {
        applyDispatch({ v: BRIDGE_VERSION, store: 'pomodoro', action: 'applySettings', args: [900, 180, 5, true, true] });

        const state = usePomodoroStore.getState();
        expect(state.focusDurationSeconds).toBe(900);
        expect(state.breakDurationSeconds).toBe(180);
        expect(state.totalRounds).toBe(5);
        expect(state.autoStartBreak).toBe(true);
    });

    it('ignores payloads with a mismatched bridge version', () => {
        const before = useSettingsStore.getState().uiScale;
        applyDispatch({ v: 999 as 1, store: 'settings', action: 'setUiScale', args: [2.5] });
        expect(useSettingsStore.getState().uiScale).toBe(before);
    });
});
