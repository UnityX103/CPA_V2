import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoroStore } from '../pomodoro';
import { usePresenceStore } from '../presence';
import { useSettingsStore } from '../settings';
import { BRIDGE_VERSION } from './protocol';
import {
    MIRROR_WINDOW_LABELS,
    applyDispatch,
    buildSnapshot,
    pomoSig,
    presenceSig,
    settingsSig,
} from './host';

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
    usePresenceStore.setState({
        enabled: false,
        intervalSeconds: 60,
        absenceSensitivity: 'strict',
        platform: 'macos',
        availability: 'disabled',
        confirmedPresence: 'unknown',
        lastSuccessfulAt: null,
        lastError: null,
    });
});

describe('bridge host', () => {
    it('builds a retained-state snapshot', () => {
        const snapshot = buildSnapshot();

        expect(snapshot.pomodoro).toEqual(expect.objectContaining({ endActionMode: 'topWindow' }));
        expect(snapshot.presence).toEqual(expect.objectContaining({
            enabled: false,
            intervalSeconds: 60,
            absenceSensitivity: 'strict',
            availability: 'disabled',
        }));
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

    it('routes presence settings to the authoritative store', async () => {
        const applySettings = vi.fn();
        usePresenceStore.setState({ applySettings });

        await applyDispatch({
            v: BRIDGE_VERSION,
            store: 'presence',
            action: 'applySettings',
            args: [{ enabled: true, intervalSeconds: 30, absenceSensitivity: 'balanced' }],
        });

        expect(applySettings).toHaveBeenCalledWith({
            enabled: true,
            intervalSeconds: 30,
            absenceSensitivity: 'balanced',
        });
    });

    it('signatures ignore transient state and include retained preferences', () => {
        const settings = useSettingsStore.getState();
        const pomodoro = usePomodoroStore.getState();

        expect(settingsSig(settings)).not.toBe(settingsSig({ ...settings, autostartEnabled: true }));
        expect(pomoSig(pomodoro)).not.toBe(pomoSig({ ...pomodoro, autoPinAfterFocus: false }));
        expect(presenceSig(usePresenceStore.getState())).not.toBe(presenceSig({
            ...usePresenceStore.getState(),
            availability: 'ready',
        }));
        expect(presenceSig(usePresenceStore.getState())).not.toBe(presenceSig({
            ...usePresenceStore.getState(),
            absenceSensitivity: 'relaxed',
        }));
    });
});
