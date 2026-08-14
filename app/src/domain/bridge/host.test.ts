import { beforeEach, describe, expect, it } from 'vitest';
import { usePomodoroStore } from '../pomodoro';
import { useSettingsStore } from '../settings';
import { BRIDGE_VERSION } from './protocol';
import { MIRROR_WINDOW_LABELS, applyDispatch, buildSnapshot, pomoSig, settingsSig } from './host';

beforeEach(() => {
    useSettingsStore.setState({
        uiScale: 1,
        committedUiScale: 1,
        autostartEnabled: false,
        dangerousChange: null,
    });
    usePomodoroStore.setState({
        focusDurationSeconds: 1500,
        breakDurationSeconds: 300,
        totalRounds: 4,
        autoStartBreak: false,
        autoPinAfterFocus: true,
        endActionMode: 'topWindow',
    });
});

describe('bridge host', () => {
    it('builds a retained-state snapshot', () => {
        const snapshot = buildSnapshot();

        expect(snapshot.pomodoro).toEqual(expect.objectContaining({ endActionMode: 'topWindow' }));
    });

    it('mirrors only retained fixed windows', () => {
        expect(MIRROR_WINDOW_LABELS).toContain('settings');
        expect(MIRROR_WINDOW_LABELS).toContain('input-counter');
    });

    it('routes retained pomodoro settings', async () => {
        await applyDispatch({
            v: BRIDGE_VERSION,
            store: 'pomodoro',
            action: 'applySettings',
            args: [900, 180, 5, true, true],
        });

        expect(usePomodoroStore.getState()).toEqual(expect.objectContaining({
            focusDurationSeconds: 900,
            breakDurationSeconds: 180,
            totalRounds: 5,
            autoStartBreak: true,
        }));
    });

    it('signatures ignore transient state and include retained preferences', () => {
        const settings = useSettingsStore.getState();
        const pomodoro = usePomodoroStore.getState();

        expect(settingsSig(settings)).not.toBe(settingsSig({ ...settings, autostartEnabled: true }));
        expect(pomoSig(pomodoro)).not.toBe(pomoSig({ ...pomodoro, autoPinAfterFocus: false }));
    });
});
