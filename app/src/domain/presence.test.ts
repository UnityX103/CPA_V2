import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPresenceStore, applyInputActivitySample } from './presence';
import { createPomodoroStore, usePomodoroStore } from './pomodoro';
import { normalizePresencePreferences } from './presencePersistence';
vi.mock('./presencePersistence', async (original) => ({
    ...await original<typeof import('./presencePersistence')>(), savePresencePreferences: vi.fn(async () => {}),
}));
beforeEach(() => usePomodoroStore.getState().reset());

describe('input-only automation', () => {
    it('hydrates legacy camera preferences without retaining camera control or access actions', () => {
        const presence = createPresenceStore({ isSettingsWindow: false });
        presence.getState().hydrate(normalizePresencePreferences({ enabled: true, inputActivityEnabled: true,
            cameraDeviceId: 'camera-usb', absenceSensitivity: 'relaxed', intervalSeconds: 600 }));
        expect(presence.getState()).toMatchObject({ inputActivityEnabled: true,
            inputActivityAvailability: 'waiting', confirmedPresence: 'unknown' });
        for (const field of ['enabled', 'cameraDeviceId', 'requestAccess', 'retry', 'openPrivacySettings']) {
            expect(presence.getState()).not.toHaveProperty(field);
        }
    });
    it('retains fresh input evidence when changing only the optional reminder', async () => {
        const presence = createPresenceStore({ isSettingsWindow: false });
        const pomodoro = createPomodoroStore({ isSettingsWindow: false });
        presence.getState().hydrate({ inputActivityEnabled: true, restDeskReminderEnabled: false,
            restDeskReminderMode: 'cockroachInvasion' });
        applyInputActivitySample(presence, pomodoro, 0, 1000);
        await presence.getState().applySettings({ inputActivityEnabled: true, restDeskReminderEnabled: true,
            restDeskReminderMode: 'cockroachInvasion' });
        expect(presence.getState()).toMatchObject({ inputActivityAvailability: 'ready', inputIdleMs: 0,
            inputSampleAt: 1000, confirmedPresence: 'present', restDeskReminderEnabled: true });
    });
    it('revoking input clears evidence and automatic ownership without changing the remaining time', async () => {
        const presence = createPresenceStore({ isSettingsWindow: false });
        const pomodoro = usePomodoroStore;
        presence.setState({ inputActivityEnabled: true });
        pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 273 });
        applyInputActivitySample(presence, pomodoro, 0, 1000);
        await presence.getState().applySettings({ inputActivityEnabled: false,
            restDeskReminderEnabled: true, restDeskReminderMode: 'cockroachInvasion' });
        expect(presence.getState()).toMatchObject({ inputActivityAvailability: 'disabled',
            inputIdleMs: null, inputSampleAt: null, confirmedPresence: 'unknown', restDeskReminderEnabled: false });
        expect(pomodoro.getState()).toMatchObject({ presenceAutomationState: 'none', remainingSeconds: 273 });
    });
    it.each([true, false])('counts a real newly entered break after the first idle poll (autoStart=%s)', (autoStartBreak) => {
        const presence = createPresenceStore({ isSettingsWindow: false });
        const pomodoro = createPomodoroStore({ isSettingsWindow: false });
        presence.getState().hydrate(normalizePresencePreferences({ enabled: true, inputActivityEnabled: true,
            intervalSeconds: 600, absenceThresholds: { balanced: 30 } }));
        pomodoro.getState().applySettings(1, 300, 4, true, autoStartBreak);
        pomodoro.getState().start(); pomodoro.getState().tick(1);
        applyInputActivitySample(presence, pomodoro, 0, 1000);
        expect(pomodoro.getState()).toMatchObject({ isRunning: false, remainingSeconds: 300 });
        applyInputActivitySample(presence, pomodoro, 5000, 6000);
        pomodoro.getState().tick(1);
        expect(pomodoro.getState()).toMatchObject({ currentPhase: 'break', isRunning: true,
            remainingSeconds: 299, presenceAutomationState: 'none' });
    });
});
