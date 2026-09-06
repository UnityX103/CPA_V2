import { beforeEach, describe, expect, it } from 'vitest';
import { createPomodoroStore } from './pomodoro';
import { createPomodoroBroadcast } from './pomodoroBroadcast';
import { applyPresenceSample, usePresenceStore } from './presence';
import type { PomodoroRuleEvent } from './pomodoroEvents';

beforeEach(() => usePresenceStore.setState({ enabled: true, confirmedPresence: 'absent' }));
function fixture() {
    const store = createPomodoroStore({ isSettingsWindow: false });
    store.getState().applySettings(2, 2, 2, true, false);
    const broadcast = createPomodoroBroadcast(store);
    const signals: PomodoroRuleEvent[] = [];
    broadcast.subscribe((event) => signals.push(...event.signals ?? []));
    const stop = broadcast.start();
    return { store, signals, stop };
}

describe('public Pomodoro rule events', () => {
    it('emits each start/end once across a full cycle, without treating pause/resume as a new phase', () => {
        const { store, signals, stop } = fixture();
        store.getState().start();
        store.getState().pause();
        store.getState().start();
        store.getState().tick(1);
        expect(signals).toEqual(['focus.started']);
        store.getState().tick(1);
        expect(signals).toEqual(['focus.started', 'focus.ended']);
        store.getState().start();
        store.getState().tick(2);
        expect(signals).toContain('break.started');
        expect(signals).toContain('break.ended');
        stop();
    });

    it('fires workstation presence when starting while already at the desk', () => {
        usePresenceStore.setState({ enabled: true, confirmedPresence: 'present' });
        const { store, signals, stop } = fixture();
        expect(signals).toEqual([]);
        store.getState().start();
        expect(signals).toEqual(['focus.started', 'focus.present']);
        stop();
    });

    it('emits presence only once per arrival, and re-arms after absence', () => {
        const { store, signals, stop } = fixture();
        store.getState().start();
        usePresenceStore.setState({ confirmedPresence: 'present' });
        store.getState().tick(0.1);
        store.getState().pause();
        store.getState().start();
        expect(signals.filter((signal) => signal === 'focus.present')).toHaveLength(1);
        usePresenceStore.setState({ confirmedPresence: 'absent' });
        usePresenceStore.setState({ confirmedPresence: 'present' });
        expect(signals.filter((signal) => signal === 'focus.present')).toHaveLength(2);
        store.getState().tick(2);
        store.getState().start();
        expect(signals).not.toContain('break.present');
        stop();
    });

    it('does not fire break presence on manual pauses, override, or snapshots', () => {
        const { store, signals, stop } = fixture();
        store.getState().start();
        store.getState().tick(2);
        store.getState().start();
        store.getState().pause();
        applyPresenceSample(usePresenceStore, store, { observation: 'present', availability: 'ready', errorCode: null }, 0);
        expect(signals).not.toContain('break.present');

        store.getState().start();
        applyPresenceSample(usePresenceStore, store, { observation: 'present', availability: 'ready', errorCode: null }, 1);
        expect(signals.filter((signal) => signal === 'break.present')).toHaveLength(1);
        store.getState().start(); // Explicitly continuing a presence-owned pause overrides automation.
        applyPresenceSample(usePresenceStore, store, { observation: 'present', availability: 'ready', errorCode: null }, 2);
        expect(store.getState().isRunning).toBe(true);
        expect(signals.filter((signal) => signal === 'break.present')).toHaveLength(1);
        stop();
    });

    it('does not replay events from snapshots or disabled/unknown presence', () => {
        const { store, signals, stop } = fixture();
        expect(signals).toEqual([]);
        usePresenceStore.setState({ enabled: false, confirmedPresence: 'present' });
        store.getState().start();
        usePresenceStore.setState({ confirmedPresence: 'unknown' });
        expect(signals).toEqual(['focus.started']);
        stop();
        usePresenceStore.setState({ enabled: true, confirmedPresence: 'present' });
        expect(signals).toEqual(['focus.started']);
    });
});
