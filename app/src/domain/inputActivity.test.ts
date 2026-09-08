import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPomodoroStore } from './pomodoro';
import { applyInputActivitySample, applyPresenceSample, createPresenceStore } from './presence';
import { createPomodoroBroadcast } from './pomodoroBroadcast';
import { startInputActivityMonitor } from './inputActivity';

vi.mock('./presencePersistence', async (original) => ({
    ...await original<typeof import('./presencePersistence')>(),
    savePresencePreferences: vi.fn(async () => {}),
}));

function fixture(camera = false) {
    const store = createPresenceStore({ isSettingsWindow: false });
    const pomodoro = createPomodoroStore({ isSettingsWindow: false });
    store.setState({ inputActivityEnabled: true, enabled: camera, absenceSensitivity: 'strict' });
    pomodoro.setState({ currentPhase: 'break', isRunning: true, remainingSeconds: 300 });
    const input = (idleMs: number | null, time = 0) => applyInputActivitySample(store, pomodoro, idleMs, time);
    const cameraSample = (observation: 'present' | 'absent' | 'unknown', time = 0) =>
        applyPresenceSample(store, pomodoro, { observation, availability: observation === 'unknown' ? 'error' : 'ready', errorCode: null }, time);
    return { store, pomodoro, input, cameraSample };
}

describe('break input and camera evidence', () => {
    it('works with camera disabled and emits one break.present signal per automatic pause', () => {
        const f = fixture();
        const events: string[] = [];
        const broadcast = createPomodoroBroadcast(f.pomodoro, () => 0, f.store);
        broadcast.subscribe((event) => events.push(...event.signals ?? []));
        const stop = broadcast.start();
        f.input(0);
        f.input(0, 5000);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        expect(f.store.getState().availability).toBe('disabled');
        f.input(30_000, 35_000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        f.input(0, 40_000);
        expect(events.filter((event) => event === 'break.present')).toHaveLength(2);
        stop();
    });

    it('requires both enabled sources to confirm absence and counts only camera samples', () => {
        const f = fixture(true);
        f.input(0);
        f.cameraSample('absent', 0);
        for (let time = 5000; time <= 30_000; time += 5000) f.input(30_000, time);
        expect(f.store.getState().consecutiveAbsentSamples).toBe(1);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        f.cameraSample('absent', 30_000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        f.cameraSample('present', 35_000);
        f.input(60_000, 35_000);
        expect(f.pomodoro.getState().isRunning).toBe(false);
    });

    it('input presence wins over camera absence, failure, and late camera results', () => {
        const f = fixture(true);
        f.input(0);
        f.cameraSample('absent', 1000);
        f.cameraSample('absent', 2000);
        f.cameraSample('unknown', 3000);
        expect(f.store.getState().confirmedPresence).toBe('present');
        expect(f.pomodoro.getState().isRunning).toBe(false);
        f.input(null, 5000);
        expect(f.store.getState().confirmedPresence).toBe('unknown');
        expect(f.pomodoro.getState().isRunning).toBe(false);
    });

    it('does not trust an expired camera observation or infer absence from an input error', () => {
        const f = fixture(true);
        f.cameraSample('present');
        f.input(60_000, 60_000);
        expect(f.store.getState().confirmedPresence).toBe('unknown');
        expect(f.pomodoro.getState().isRunning).toBe(false);
        f.input(null, 65_000);
        expect(f.pomodoro.getState().isRunning).toBe(false);
    });

    it('preserves manual pause and manual continue overrides', () => {
        const f = fixture();
        f.input(0);
        f.pomodoro.getState().start();
        f.input(0, 5000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        f.input(30_000, 35_000);
        f.input(0, 40_000);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        f.pomodoro.getState().pause();
        f.input(30_000, 75_000);
        expect(f.pomodoro.getState().isRunning).toBe(false);
    });

    it('input never starts or pauses focus', () => {
        const f = fixture();
        f.pomodoro.setState({ currentPhase: 'focus', isRunning: true });
        f.input(0);
        f.input(60_000, 60_000);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        expect(f.store.getState().confirmedPresence).toBe('unknown');
    });
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function monitor() {
    const f = fixture();
    const sample = vi.fn(async () => 60_000);
    const stop = startInputActivityMonitor({ ...f, runtime: {
        sample, now: () => Date.now(),
        setInterval: (cb, ms) => window.setInterval(cb, ms),
        clearInterval: (id) => window.clearInterval(id),
    } });
    return { ...f, sample, stop };
}

describe('input sampling lifecycle', () => {
    it('polls every five seconds only in eligible breaks, including automatic pauses', async () => {
        const f = monitor();
        await vi.advanceTimersByTimeAsync(4999);
        expect(f.sample).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(f.sample).toHaveBeenCalledTimes(2);
        f.sample.mockResolvedValue(0);
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.pomodoro.getState().presenceAutomationState).toBe('breakPaused');
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.sample).toHaveBeenCalledTimes(4);
        f.pomodoro.getState().pause();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(f.sample).toHaveBeenCalledTimes(4);
        f.pomodoro.setState({ currentPhase: 'focus', isRunning: true });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(f.sample).toHaveBeenCalledTimes(4);
        f.pomodoro.setState({ currentPhase: 'break' });
        await vi.advanceTimersByTimeAsync(0);
        expect(f.sample).toHaveBeenCalledTimes(5);
        f.store.setState({ inputActivityEnabled: false });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(f.sample).toHaveBeenCalledTimes(5);
        expect(vi.getTimerCount()).toBe(0);
        f.stop();
    });

    it('does not overlap requests or accept results after revocation, stop, or another break', async () => {
        const f = fixture();
        let resolve!: (value: number) => void;
        const sample = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
        const stop = startInputActivityMonitor({ ...f, runtime: {
            sample, now: () => Date.now(),
            setInterval: (cb, ms) => window.setInterval(cb, ms), clearInterval: (id) => window.clearInterval(id),
        } });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sample).toHaveBeenCalledTimes(1);
        f.store.setState({ inputActivityEnabled: false });
        resolve(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        f.store.setState({ inputActivityEnabled: true });
        f.pomodoro.setState({ currentRound: 2 });
        resolve(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        await vi.advanceTimersByTimeAsync(5000);
        stop();
        resolve(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(f.pomodoro.getState().isRunning).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('never queries before opt-in and can run without camera access', async () => {
        const f = fixture();
        f.store.setState({ inputActivityEnabled: false });
        const sample = vi.fn(async () => 0);
        const stop = startInputActivityMonitor({ ...f, runtime: {
            sample, now: () => Date.now(),
            setInterval: (cb, ms) => window.setInterval(cb, ms), clearInterval: (id) => window.clearInterval(id),
        } });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sample).not.toHaveBeenCalled();
        f.store.setState({ inputActivityEnabled: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(sample).toHaveBeenCalledTimes(1);
        expect(f.pomodoro.getState().isRunning).toBe(false);
        stop();
    });
});
